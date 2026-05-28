package com.workplace.issue.service;

import com.workplace.global.dto.PageResponse;
import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.dto.ParentRef;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.exception.InvalidTypeForProjectException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.ParentCannotBeSubtaskException;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.exception.SetParentOnNonSubtaskException;
import com.workplace.issue.exception.SubtaskParentRequiredException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.repository.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 이슈 라이프사이클 서비스. 멤버십 가드 + 시퀀스 발급 + 히스토리 기록을 조합한다. */
@Service
@Transactional
@RequiredArgsConstructor
public class IssueService {

  private final IssueRepository issueRepository;
  private final IssueCommentRepository commentRepository;
  private final IssueHistoryRepository historyRepository;
  private final IssueLabelRepository issueLabelRepository;
  private final IssueAttachmentRepository issueAttachmentRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final IssueTypeRepository typeRepository;
  private final IssueDependencyRepository dependencyRepository;
  private final IssueFieldValueRepository fieldValueRepository;
  private final ProjectIssueSequenceRepository sequenceRepository;
  private final ProjectMemberRepository memberRepository;
  private final ProjectAccessGuard accessGuard;
  private final IssueHistoryRecorder historyRecorder;
  private final com.workplace.watcher.service.WatcherAutoEnroller watcherAutoEnroller;
  private final ApplicationEventPublisher publisher;
  private final UserRepository userRepository;

  /**
   * 신규 이슈 생성. priority 기본값(MID)을 서비스에서 보정. assigneeIds 가 비어있지 않으면 issue_assignee 매핑까지 동시 INSERT.
   * typeId 미지정 시 프로젝트의 TASK 시스템 유형으로 fallback. SUBTASK 면 parentNumber 필수 + 부모 검증, 비SUBTASK 면
   * parentNumber 지정 불가 (Phase 4a).
   */
  public IssueResponse create(Long callerId, String projectKey, CreateIssueRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);

    // 1) 담당자 멤버십 검증
    List<Long> assigneeIds = req.assigneeIds() == null ? List.of() : req.assigneeIds();
    if (!assigneeIds.isEmpty()) {
      var memberIds = memberRepository.findUserIdsByProject(project.id());
      if (!new HashSet<>(memberIds).containsAll(assigneeIds)) {
        throw new InvalidAssigneeForProjectException();
      }
    }

    // 2) typeId 결정 — 지정 시 같은 프로젝트 검증, 아니면 TASK fallback. typeRow 는 이후 SUBTASK 분기 판정에 재사용.
    com.workplace.issue.dto.IssueTypeRow typeRow;
    if (req.typeId() != null) {
      typeRow =
          typeRepository.findById(req.typeId()).orElseThrow(InvalidTypeForProjectException::new);
      if (!typeRow.projectId().equals(project.id())) {
        throw new InvalidTypeForProjectException();
      }
    } else {
      typeRow =
          typeRepository
              .findByProjectAndName(project.id(), "TASK")
              .orElseThrow(() -> new IllegalStateException("프로젝트에 TASK 유형이 없음"));
    }
    Long typeId = typeRow.id();

    // 3) parent 검증 (Phase 4a) — SUBTASK 만 parent 가능, SUBTASK 는 parent 필수.
    Long parentIssueId = null;
    boolean isSubtask = "SUBTASK".equals(typeRow.name());
    if (req.parentNumber() != null) {
      if (!isSubtask) throw new ParentNotAllowedException();
      var parent =
          issueRepository
              .findByProjectAndNumber(project.id(), req.parentNumber())
              .orElseThrow(() -> new InvalidParentException("부모 이슈 없음"));
      var parentType =
          typeRepository
              .findById(parent.typeId())
              .orElseThrow(() -> new InvalidParentException("부모 유형 없음"));
      if ("SUBTASK".equals(parentType.name())) throw new ParentCannotBeSubtaskException();
      parentIssueId = parent.id();
    } else if (isSubtask) {
      throw new SubtaskParentRequiredException();
    }

    int number = sequenceRepository.allocateNext(project.id());
    var row =
        issueRepository.insert(
            project.id(),
            number,
            req.title(),
            req.body(),
            req.priority() != null ? req.priority() : "MID",
            req.dueDate(),
            callerId,
            typeId,
            parentIssueId);

    // 3) issue_assignee 매핑 INSERT
    for (Long uid : assigneeIds) {
      assigneeRepository.add(row.id(), uid, callerId);
    }

    // 4) watcher 자동 등록: reporter + 각 assignee (caller 와 다를 때만)
    watcherAutoEnroller.enroll(row.id(), callerId);
    for (Long uid : assigneeIds) {
      if (!uid.equals(callerId)) watcherAutoEnroller.enroll(row.id(), uid);
    }

    // 5) 도메인 이벤트 발행 (AFTER_COMMIT 에서 ai-agent dispatcher 가 받아 발사)
    //    - IssueCreatedEvent 는 항상 발행 (assignee 가 비어있어도)
    //    - assignee 가 있으면 initial 상태로 IssueAssignedEvent 도 함께 발행 (added=all, removed=[])
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    List<UserSummary> assigneeSummaries =
        assigneeIds.isEmpty()
            ? List.of()
            : userRepository.findByIds(assigneeIds).stream()
                .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
                .toList();
    String issueKey = project.key() + "-" + number;
    Instant occurredAt = Instant.now();
    publisher.publishEvent(
        new IssueCreatedEvent(
            row.id(),
            project.key(),
            issueKey,
            row.title(),
            row.status(),
            row.priority(),
            actor,
            assigneeSummaries,
            occurredAt));
    if (!assigneeSummaries.isEmpty()) {
      publisher.publishEvent(
          new IssueAssignedEvent(
              row.id(),
              project.key(),
              issueKey,
              row.title(),
              actor,
              assigneeSummaries,
              assigneeSummaries,
              List.of(),
              occurredAt));
    }

    return IssueResponse.from(project.key(), row);
  }

  /** 프로젝트 내 이슈 목록 페이지 조회. */
  @Transactional(readOnly = true)
  public PageResponse<IssueResponse> list(Long callerId, String projectKey, int page, int size) {
    var project = accessGuard.assertMember(projectKey, callerId);
    long total = issueRepository.countByProject(project.id());
    var rows = issueRepository.findByProject(project.id(), page, size);
    int totalPages = (size == 0) ? 0 : (int) Math.ceil((double) total / size);
    return new PageResponse<>(
        rows.stream().map(r -> IssueResponse.from(project.key(), r)).toList(),
        page,
        size,
        total,
        totalPages);
  }

  /** 이슈 상세 조회 (요약 + 본문 + 코멘트 + 히스토리 + 담당자 + 유형). */
  @Transactional(readOnly = true)
  public IssueDetailResponse get(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var labels = issueLabelRepository.findLabelsByIssue(row.id());
    var attachments = issueAttachmentRepository.findByIssue(row.id());
    var assignees = assigneeRepository.findByIssue(row.id());
    var typeMap = typeRepository.findByIds(List.of(row.typeId()));
    var type = typeMap.get(row.typeId());
    var comments = commentRepository.findByIssue(row.id());
    var history = historyRepository.findByIssue(row.id());
    // Phase 4a — 부모/자식 트리 정보. SUBTASK 면 parent 채움, 비SUBTASK 면 자식 집계.
    var parentRef =
        row.parentIssueId() == null
            ? null
            : issueRepository.findParentRefsByIssueIds(List.of(row.id())).get(row.id());
    int childCount =
        issueRepository.countChildrenByParentIds(List.of(row.id())).getOrDefault(row.id(), 0);
    int childDoneCount =
        issueRepository.countDoneChildrenByParentIds(List.of(row.id())).getOrDefault(row.id(), 0);
    // Phase 4b — 의존성 batch (단일 이슈 경로도 동일 API 사용).
    var ids = List.of(row.id());
    var blockedByMap = dependencyRepository.findBlockedByForIssues(ids);
    var blocksMap = dependencyRepository.findBlocksForIssues(ids);
    var blockedMap = dependencyRepository.findBlockedFlags(ids);
    // Phase 4c — custom field 값 batch (단일 이슈 경로도 동일 API).
    var fieldsByIssue = fieldValueRepository.findByIssueIds(ids);
    return new IssueDetailResponse(
        IssueResponse.fromWithCustomFields(
            project.key(),
            row,
            labels,
            attachments.size(),
            type,
            assignees,
            parentRef,
            childCount,
            childDoneCount,
            blockedByMap.getOrDefault(row.id(), List.of()),
            blocksMap.getOrDefault(row.id(), List.of()),
            blockedMap.getOrDefault(row.id(), false),
            fieldsByIssue.getOrDefault(row.id(), List.of())),
        row.body(),
        comments,
        history,
        attachments);
  }

  /** 이슈 부분 수정. null 필드는 변경 없음, clearDueDate 플래그로 명시적 NULL 설정 지원. 담당자는 별도 PUT /assignees 흐름에서 관리. */
  public IssueDetailResponse update(
      Long callerId, String projectKey, int number, UpdateIssueRequest req) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var before =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    String newTitle = req.title() != null ? req.title() : before.title();
    String newBody = req.body() != null ? req.body() : before.body();
    String newStatus = req.status() != null ? req.status() : before.status();
    String newPriority = req.priority() != null ? req.priority() : before.priority();
    LocalDate newDue =
        Boolean.TRUE.equals(req.clearDueDate())
            ? null
            : (req.dueDate() != null ? req.dueDate() : before.dueDate());

    // closed_at 전이: 종료 상태로 진입 시 now(), 재오픈 시 NULL, 그 외 유지
    boolean wasClosed = before.status().equals("DONE") || before.status().equals("CANCELED");
    boolean nowClosed = newStatus.equals("DONE") || newStatus.equals("CANCELED");
    Instant newClosedAt;
    if (nowClosed && !wasClosed) {
      newClosedAt = Instant.now();
    } else if (!nowClosed && wasClosed) {
      newClosedAt = null;
    } else {
      newClosedAt = before.closedAt();
    }

    issueRepository.updateAll(
        before.id(), newTitle, newBody, newStatus, newPriority, newDue, newClosedAt);
    var after = issueRepository.findById(before.id()).orElseThrow();

    // 상태 전이가 있을 때만 IssueStatusChangedEvent 발행 (AFTER_COMMIT 에서 ai-agent 발사 후보)
    if (!before.status().equals(after.status())) {
      var actor =
          userRepository
              .findById(callerId)
              .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
              .orElse(null);
      var currentAssignees = assigneeRepository.findByIssue(after.id());
      String issueKey = project.key() + "-" + after.number();
      publisher.publishEvent(
          new IssueStatusChangedEvent(
              after.id(),
              project.key(),
              issueKey,
              after.title(),
              actor,
              currentAssignees,
              before.status(),
              after.status(),
              Instant.now()));
    }

    historyRecorder.recordChanges(callerId, before, after);

    return get(callerId, projectKey, number);
  }

  /** DnD 등에서 status 만 변경. update(...) 의 단축 경로 — 히스토리 기록도 동일하게 수행. */
  public IssueDetailResponse updateStatus(
      Long callerId, String projectKey, int number, String newStatus) {
    var req = new UpdateIssueRequest(null, null, newStatus, null, null, false);
    return update(callerId, projectKey, number, req);
  }

  /**
   * 이슈 유형 변경 — 멤버 권한. 같은 프로젝트의 유형만 허용. 기존과 동일한 유형이면 history 미기록 fast-return. 변경 시 TYPE_CHANGED
   * history 한 건 기록.
   */
  public IssueDetailResponse setType(Long callerId, String projectKey, int number, Long newTypeId) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var issue =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var newType =
        typeRepository.findById(newTypeId).orElseThrow(InvalidTypeForProjectException::new);
    if (!newType.projectId().equals(project.id())) {
      throw new InvalidTypeForProjectException();
    }
    if (newType.id().equals(issue.typeId())) {
      return get(callerId, projectKey, number);
    }
    var oldType = typeRepository.findById(issue.typeId()).orElseThrow();

    // Phase 4a — SUBTASK → 비SUBTASK 전환 시 부모 자동 해제 + PARENT_CHANGED 기록 (parent 있을 때만).
    if ("SUBTASK".equals(oldType.name())
        && !"SUBTASK".equals(newType.name())
        && issue.parentIssueId() != null) {
      var oldParent = issueRepository.findById(issue.parentIssueId()).orElseThrow();
      var oldParentType = typeRepository.findById(oldParent.typeId()).orElseThrow();
      var oldParentRef =
          new ParentRef(
              oldParent.number(),
              oldParent.title(),
              new IssueTypeSummary(
                  oldParentType.id(),
                  oldParentType.name(),
                  oldParentType.colorToken(),
                  oldParentType.icon()));
      issueRepository.updateParent(issue.id(), null);
      historyRecorder.recordParentChanged(callerId, issue.id(), oldParentRef, null);
    }

    issueRepository.updateType(issue.id(), newType.id());
    historyRecorder.recordTypeChanged(
        callerId,
        issue.id(),
        new IssueTypeSummary(oldType.id(), oldType.name(), oldType.colorToken(), oldType.icon()),
        new IssueTypeSummary(newType.id(), newType.name(), newType.colorToken(), newType.icon()));
    return get(callerId, projectKey, number);
  }

  /** 이슈 soft-delete. reporter 본인 또는 프로젝트 OWNER 만 가능. */
  public void softDelete(Long callerId, String projectKey, int number) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    boolean isReporter = row.reporterId().equals(callerId);
    boolean isOwner = false;
    try {
      accessGuard.assertWithRole(projectKey, callerId, "OWNER");
      isOwner = true;
    } catch (ProjectAccessDeniedException ignored) {
      // OWNER 아님 — isReporter 만으로 판단
    }

    if (!isReporter && !isOwner) {
      throw new ProjectAccessDeniedException("이슈 삭제는 reporter 또는 OWNER 만 가능합니다");
    }
    // Phase 4a — 부모 자체와 활성 자식들에 동일 timestamp 로 cascade soft-delete.
    var now = Instant.now();
    issueRepository.softDelete(row.id(), now);
    issueRepository.softDeleteChildren(row.id(), now);
  }

  /**
   * SUBTASK 의 부모 설정/해제. newParentNumber == null 이면 해제. 비SUBTASK 에 호출하면 {@link
   * SetParentOnNonSubtaskException}. 부모 검증은 create 와 동일 — 같은 프로젝트, 존재, type != SUBTASK, 자기 자신 X.
   * diff 0 이면 history 미기록 fast-return.
   */
  public IssueDetailResponse setParent(
      Long callerId, String projectKey, int number, Integer newParentNumber) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var currentType = typeRepository.findById(row.typeId()).orElseThrow();
    if (!"SUBTASK".equals(currentType.name())) {
      throw new SetParentOnNonSubtaskException();
    }

    Long newParentId = null;
    ParentRef newRef = null;
    if (newParentNumber != null) {
      if (newParentNumber == row.number()) throw new InvalidParentException("자기 자신");
      var newParent =
          issueRepository
              .findByProjectAndNumber(project.id(), newParentNumber)
              .orElseThrow(() -> new InvalidParentException("부모 이슈 없음"));
      var newParentType =
          typeRepository
              .findById(newParent.typeId())
              .orElseThrow(() -> new InvalidParentException("부모 유형 없음"));
      if ("SUBTASK".equals(newParentType.name())) throw new ParentCannotBeSubtaskException();
      newParentId = newParent.id();
      newRef =
          new ParentRef(
              newParent.number(),
              newParent.title(),
              new IssueTypeSummary(
                  newParentType.id(),
                  newParentType.name(),
                  newParentType.colorToken(),
                  newParentType.icon()));
    }

    Long currentParentId = row.parentIssueId();
    if (java.util.Objects.equals(currentParentId, newParentId)) {
      return get(callerId, projectKey, number);
    }

    ParentRef oldRef = null;
    if (currentParentId != null) {
      var oldParent = issueRepository.findById(currentParentId).orElseThrow();
      var oldParentType = typeRepository.findById(oldParent.typeId()).orElseThrow();
      oldRef =
          new ParentRef(
              oldParent.number(),
              oldParent.title(),
              new IssueTypeSummary(
                  oldParentType.id(),
                  oldParentType.name(),
                  oldParentType.colorToken(),
                  oldParentType.icon()));
    }

    issueRepository.updateParent(row.id(), newParentId);
    historyRecorder.recordParentChanged(callerId, row.id(), oldRef, newRef);
    return get(callerId, projectKey, number);
  }
}
