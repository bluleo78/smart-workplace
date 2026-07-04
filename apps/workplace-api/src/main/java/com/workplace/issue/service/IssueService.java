package com.workplace.issue.service;

import com.workplace.drive.service.DriveLinkService;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.security.PermissionChecker;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueAiContext;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.dto.ParentRef;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.EpicCannotHaveParentException;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.exception.InvalidTypeForProjectException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.ParentCannotBeSubtaskException;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.exception.SubtaskParentCannotBeEpicException;
import com.workplace.issue.exception.SubtaskParentRequiredException;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.repository.IssueAiSummaryRepository;
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
  private final DriveLinkService driveLinkService;
  private final PermissionChecker permissionChecker;

  /** AI 즉시 컨텍스트: 저장 요약 조회. */
  private final IssueAiSummaryRepository aiSummaryRepository;

  /** AI 즉시 컨텍스트: 블로커 결정적 계산기 (새 쿼리 0). */
  private final IssueBlockerCalculator blockerCalculator;

  /**
   * 신규 이슈 생성. priority 기본값(MID)을 서비스에서 보정. assigneeIds 가 비어있지 않으면 issue_assignee 매핑까지 동시 INSERT.
   * typeId 미지정 시 프로젝트의 TASK 시스템 유형으로 fallback. SUBTASK 면 parentNumber 필수 + 부모 검증, 비SUBTASK 면
   * parentNumber 지정 불가 (Phase 4a).
   */
  public IssueResponse create(Long callerId, String projectKey, CreateIssueRequest req) {
    // OPEN 프로젝트는 테넌트 전원이 이슈를 생성할 수 있다(assertIssueCreatable). TEAM/PERSONAL 은 멤버만.
    var project = accessGuard.assertIssueCreatable(projectKey, callerId);

    // 1) 담당자 검증 — 개인·팀 공통으로 프로젝트 멤버만 담당 가능 (정책 통일 #418)
    List<Long> assigneeIds = req.assigneeIds() == null ? List.of() : req.assigneeIds();
    if (!assigneeIds.isEmpty()) {
      var allowed = AssigneePolicy.allowedAssigneeIds(project, memberRepository);
      if (!allowed.containsAll(assigneeIds)) {
        throw new InvalidAssigneeForProjectException();
      }
    }

    // 2) typeId 결정 — 지정 시 같은 프로젝트 검증, 아니면 TASK fallback. typeRow 는 이후 SUBTASK 분기 판정에 재사용.
    //    개인 프로젝트는 TASK 단일 유형만 허용(#226) — req.typeId() 와 무관하게 항상 TASK 로 강제하여
    //    잘못된/비TASK typeId 가 들어와도 견고하게 TASK 로 귀결시킨다.
    com.workplace.issue.dto.IssueTypeRow typeRow;
    if ("PERSONAL".equals(project.type())) {
      typeRow =
          typeRepository
              .findByProjectAndName(project.id(), "TASK")
              .orElseThrow(() -> new IllegalStateException("프로젝트에 TASK 유형이 없음"));
    } else if (req.typeId() != null) {
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

    // 3) parent 검증 — SUBTASK 는 비-EPIC 비-SUBTASK 부모 필수, 일반 이슈는 EPIC 부모만 선택 가능,
    //    EPIC 은 부모를 가질 수 없음(최상위 컨테이너). (Phase 4a + EPIC 계층 확장)
    Long parentIssueId = null;
    boolean isSubtask = "SUBTASK".equals(typeRow.name());
    boolean isEpic = "EPIC".equals(typeRow.name());
    if (req.parentNumber() != null) {
      if (isEpic) throw new EpicCannotHaveParentException();
      var parent =
          issueRepository
              .findByProjectAndNumber(project.id(), req.parentNumber())
              .orElseThrow(() -> new InvalidParentException("부모 이슈 없음"));
      var parentType =
          typeRepository
              .findById(parent.typeId())
              .orElseThrow(() -> new InvalidParentException("부모 유형 없음"));
      boolean parentIsSubtask = "SUBTASK".equals(parentType.name());
      boolean parentIsEpic = "EPIC".equals(parentType.name());
      if (isSubtask) {
        if (parentIsSubtask) throw new ParentCannotBeSubtaskException();
        if (parentIsEpic) throw new SubtaskParentCannotBeEpicException();
      } else if (!parentIsEpic) {
        throw new ParentNotAllowedException();
      }
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
    // read 진입점 — OPEN 은 테넌트 전원 목록 조회 허용(assertReadable).
    var project = accessGuard.assertReadable(projectKey, callerId);
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
    // read 진입점 — OPEN 은 테넌트 전원 상세 조회 허용(assertReadable). TEAM/PERSONAL 은 멤버/소유자만.
    var project = accessGuard.assertReadable(projectKey, callerId);
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
    // 이미 로드된 IssueResponse 로 블로커를 결정적으로 계산한다(새 쿼리 0).
    var summaryResponse =
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
            fieldsByIssue.getOrDefault(row.id(), List.of()));
    // AI Instant Context: 항상 반환 — 블로커는 항상 계산, summary/nextAction/generatedAt 은 저장본 없으면 null.
    // 생성 버튼은 항상 렌더(aiContext non-null)해야 하므로 저장본/블로커 여부와 무관하게 인스턴스화.
    var blockers = blockerCalculator.compute(summaryResponse, LocalDate.now(), Instant.now());
    var stored = aiSummaryRepository.find(row.id()).orElse(null);
    IssueAiContext aiContext =
        new IssueAiContext(
            stored != null ? stored.summary() : null,
            stored != null ? stored.nextAction() : null,
            stored != null ? stored.generatedAt() : null,
            blockers);
    // viewer capability — 프론트 단일 소스. write 가드와 정확히 일치시켜 플래그가 실제 허용 여부를 예측하게 한다.
    //   워크플로(상태/유형 등)=멤버/ADMIN(assertMember 경로), 내용=멤버/ADMIN or (OPEN && reporter 본인),
    //   삭제=reporter 본인 or OWNER(softDelete 규칙).
    boolean memberOrAdmin = accessGuard.isMemberOrAdmin(project, callerId);
    boolean isReporter = row.reporterId() != null && row.reporterId().equals(callerId);
    boolean isOwner = accessGuard.isOwner(project, callerId);
    boolean canWorkflow = memberOrAdmin;
    boolean canContent = memberOrAdmin || ("OPEN".equals(project.type()) && isReporter);
    boolean canDelete = isReporter || isOwner;

    return new IssueDetailResponse(
        summaryResponse,
        row.body(),
        comments,
        history,
        attachments,
        aiContext,
        canContent,
        canWorkflow,
        canDelete);
  }

  /**
   * 조회 권한(assertReadable) 확인 후 issueId 해석. 컨트롤러의 AI 요약 엔드포인트가 프록시 경유 @Transactional 호출로 GUC 주입을
   * 보장받기 위해 사용한다. OPEN 은 테넌트 전원 조회 가능.
   *
   * <p>⚠️ self-invocation 금지: 이 메서드와 get() 을 같은 빈 내부에서 조합하면 @Transactional 프록시를 우회해 GUC 미주입 → RLS
   * fail-closed. 오케스트레이션은 반드시 컨트롤러에서 각각 독립 호출한다.
   */
  @Transactional(readOnly = true)
  public long resolveAccessibleIssueId(Long callerId, String projectKey, int number) {
    // read 진입점(AI 요약 조회 프록시) — OPEN 은 테넌트 전원 허용(assertReadable).
    var project = accessGuard.assertReadable(projectKey, callerId);
    return issueRepository
        .findByProjectAndNumber(project.id(), number)
        .orElseThrow(() -> new IssueNotFoundException(projectKey, number))
        .id();
  }

  /** 이슈 부분 수정. null 필드는 변경 없음, clearDueDate 플래그로 명시적 NULL 설정 지원. 담당자는 별도 PUT /assignees 흐름에서 관리. */
  public IssueDetailResponse update(
      Long callerId, String projectKey, int number, UpdateIssueRequest req) {
    var project = accessGuard.resolve(projectKey);
    var before =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    // 권한: 멤버/ADMIN 은 전 필드(내용+워크플로), OPEN reporter 는 내용(제목/본문)만.
    //   - 비멤버는 먼저 assertContentWritable 로 내용 편집 자격(=OPEN reporter 본인)을 강제한다(아니면 403).
    //   - 워크플로 필드(상태/우선순위/마감일)는 절대 비멤버에게 열리지 않는다 — touchesWorkflow 면 403.
    //   - updateStatus() 는 update() 를 호출하므로 비멤버 reporter 의 상태 변경도 여기서 자동 차단된다.
    boolean fullEdit = accessGuard.isMemberOrAdmin(project, callerId);
    if (!fullEdit) {
      accessGuard.assertContentWritable(project, before.reporterId(), callerId);
      boolean touchesWorkflow =
          req.status() != null
              || req.priority() != null
              || req.dueDate() != null
              || Boolean.TRUE.equals(req.clearDueDate());
      if (touchesWorkflow) {
        throw new ProjectAccessDeniedException("상태·우선순위·마감일은 처리팀(멤버)만 변경할 수 있습니다");
      }
    }

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

    // 상태·우선순위 전이가 있을 때 각각 이벤트 발행 (AFTER_COMMIT 에서 ai-agent/알림 발사 후보).
    // 우선순위는 상태와 대칭적으로 모든 변경에 발행(임계치 조건 없음, #613).
    if (!before.status().equals(after.status()) || !before.priority().equals(after.priority())) {
      var actor =
          userRepository
              .findById(callerId)
              .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
              .orElse(null);
      var currentAssignees = assigneeRepository.findByIssue(after.id());
      String issueKey = project.key() + "-" + after.number();

      if (!before.status().equals(after.status())) {
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

      if (!before.priority().equals(after.priority())) {
        publisher.publishEvent(
            new IssuePriorityChangedEvent(
                after.id(),
                project.key(),
                issueKey,
                after.title(),
                actor,
                currentAssignees,
                before.priority(),
                after.priority(),
                Instant.now()));
      }
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
    // 개인 프로젝트는 TASK 단일 유형만 허용(#226) — 비TASK 유형으로의 변경을 400 으로 거부한다.
    if ("PERSONAL".equals(project.type()) && !"TASK".equals(newType.name())) {
      throw new com.workplace.issue.exception.PersonalProjectTypeFixedException();
    }
    if (newType.id().equals(issue.typeId())) {
      return get(callerId, projectKey, number);
    }
    var oldType = typeRepository.findById(issue.typeId()).orElseThrow();

    // Phase 4a — SUBTASK → 비SUBTASK 전환, 또는 (SUBTASK 여부 무관) EPIC 으로 전환 시
    // 부모 자동 해제 + PARENT_CHANGED 기록 (parent 있을 때만). EPIC 은 부모를 가질 수 없으므로
    // 예: TASK(부모=EPIC#5) → EPIC 전환 시에도 반드시 해제해야 불변식이 깨지지 않는다.
    boolean releasesParent =
        issue.parentIssueId() != null
            && (("SUBTASK".equals(oldType.name()) && !"SUBTASK".equals(newType.name()))
                || "EPIC".equals(newType.name()));

    // 최종 리뷰 발견사항 1 — releasesParent 가 발동하지 않는데 부모가 유지되는 경우, 그 부모가 새 유형
    // 규칙에서도 여전히 유효한지 create()/setParent() 와 동일한 3-way 로직으로 검증한다(Case B).
    if (!releasesParent && issue.parentIssueId() != null) {
      var retainedParent = issueRepository.findById(issue.parentIssueId()).orElseThrow();
      var retainedParentType = typeRepository.findById(retainedParent.typeId()).orElseThrow();
      boolean parentIsSubtask = "SUBTASK".equals(retainedParentType.name());
      boolean parentIsEpic = "EPIC".equals(retainedParentType.name());
      if ("SUBTASK".equals(newType.name())) {
        if (parentIsSubtask) throw new ParentCannotBeSubtaskException();
        if (parentIsEpic) throw new SubtaskParentCannotBeEpicException();
      } else if (!"EPIC".equals(newType.name()) && !parentIsEpic) {
        throw new ParentNotAllowedException();
      }
    }

    // 최종 리뷰 발견사항 1 — 이 이슈의 활성 자식들이 새 유형 아래에서도 유효한지 검증한다(Case A, C).
    // 관리 작업이라 N+1 허용(자식 목록은 대개 소수).
    var childIds = issueRepository.findActiveChildIds(issue.id());
    for (Long childId : childIds) {
      var child = issueRepository.findById(childId).orElseThrow();
      var childType = typeRepository.findById(child.typeId()).orElseThrow();
      boolean childIsSubtask = "SUBTASK".equals(childType.name());
      if ("EPIC".equals(newType.name())) {
        // EPIC 은 SUBTASK 를 자식으로 가질 수 없음(2단계 초과) — Case A.
        if (childIsSubtask) throw new SubtaskParentCannotBeEpicException();
      } else if ("SUBTASK".equals(newType.name())) {
        // SUBTASK 는 어떤 자식도 가질 수 없음.
        if (childIsSubtask) throw new ParentCannotBeSubtaskException();
        throw new ParentNotAllowedException();
      } else {
        // 일반 유형(비EPIC, 비SUBTASK) — 일반 자식은 더 이상 EPIC 부모를 갖지 못하므로 불허(Case C).
        // SUBTASK 자식은 일반 이슈 아래 그대로 허용.
        if (!childIsSubtask) throw new ParentNotAllowedException();
      }
    }

    if (releasesParent) {
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

  /**
   * 이슈 soft-delete. reporter 본인 또는 프로젝트 OWNER 만 가능.
   *
   * <p>OPEN 프로젝트는 비멤버 reporter 도 자기 이슈를 삭제할 수 있으므로, 기존 assertMember 선검증 대신 resolve 로 멤버십 없이 프로젝트
   * row 를 얻고, reporter/OWNER/ADMIN 여부로 직접 판정한다.
   */
  public void softDelete(Long callerId, String projectKey, int number) {
    // 멤버십 선검증 제거 — reporter/OWNER 로 직접 판정 (OPEN 비멤버 reporter 허용)
    var project = accessGuard.resolve(projectKey);
    var row =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));

    boolean isReporter = row.reporterId().equals(callerId);
    boolean isOwner = accessGuard.isOwner(project, callerId);
    // ADMIN 회귀 방지: 기존 구현은 assertMember(ADMIN 우회) + assertWithRole(OWNER, ADMIN 우회)로
    // ADMIN 이 비PERSONAL 이슈를 삭제할 수 있었다. resolve 로 전환하면서 이 능력이 사라지므로 명시 복원.
    boolean isAdmin =
        !"PERSONAL".equals(project.type()) && permissionChecker.userHasRole(callerId, "ADMIN");

    if (!isReporter && !isOwner && !isAdmin) {
      throw new ProjectAccessDeniedException("이슈 삭제는 reporter 또는 OWNER 만 가능합니다");
    }
    // Phase 4a — 부모 자체와 활성 자식들에 동일 timestamp 로 cascade soft-delete.
    // 자식 id 는 softDeleteChildren 호출 전에 수집해야 한다 (삭제 후엔 DELETED_AT 필터로 목록이 비어버림).
    var childIds = issueRepository.findActiveChildIds(row.id());
    var now = Instant.now();
    issueRepository.softDelete(row.id(), now);
    issueRepository.softDeleteChildren(row.id(), now);
    // 이슈(부모+자식) 삭제 시 연결된 드라이브 ref 정리 (source_id 는 비-FK 이므로 명시적 purge 필요)
    driveLinkService.purgeSource("ISSUE", row.id());
    driveLinkService.purgeSources("ISSUE", childIds);
  }

  /**
   * 이슈의 부모 설정/해제. newParentNumber == null 이면 해제. EPIC 자신은 부모를 가질 수 없다({@link
   * EpicCannotHaveParentException}). SUBTASK 는 비-EPIC 비-SUBTASK 부모만, 일반 이슈는 EPIC 부모만 허용한다. diff 0
   * 이면 history 미기록 fast-return.
   */
  public IssueDetailResponse setParent(
      Long callerId, String projectKey, int number, Integer newParentNumber) {
    var project = accessGuard.assertMember(projectKey, callerId);
    var row =
        issueRepository
            .findByProjectAndNumber(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var currentType = typeRepository.findById(row.typeId()).orElseThrow();
    boolean isSubtask = "SUBTASK".equals(currentType.name());
    boolean isEpic = "EPIC".equals(currentType.name());
    if (isEpic) {
      throw new EpicCannotHaveParentException();
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
      boolean newParentIsSubtask = "SUBTASK".equals(newParentType.name());
      boolean newParentIsEpic = "EPIC".equals(newParentType.name());
      if (isSubtask) {
        if (newParentIsSubtask) throw new ParentCannotBeSubtaskException();
        if (newParentIsEpic) throw new SubtaskParentCannotBeEpicException();
      } else if (!newParentIsEpic) {
        throw new ParentNotAllowedException();
      }
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
