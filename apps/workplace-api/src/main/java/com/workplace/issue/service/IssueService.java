package com.workplace.issue.service;

import com.workplace.component.dto.ComponentRow;
import com.workplace.component.dto.ComponentSummary;
import com.workplace.component.repository.ComponentRepository;
import com.workplace.component.service.ComponentService;
import com.workplace.cycle.dto.CycleStatus;
import com.workplace.cycle.exception.CompletedCycleNotAssignableException;
import com.workplace.cycle.exception.InvalidCycleForProjectException;
import com.workplace.cycle.repository.CycleRepository;
import com.workplace.drive.service.DriveLinkService;
import com.workplace.global.dto.PageResponse;
import com.workplace.global.dto.UserSummary;
import com.workplace.global.security.AgentToolContext;
import com.workplace.global.security.PermissionChecker;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.SingleLineTitles;
import com.workplace.issue.dto.CreateIssueRequest;
import com.workplace.issue.dto.IssueAiContext;
import com.workplace.issue.dto.IssueDetailResponse;
import com.workplace.issue.dto.IssueFieldEntry;
import com.workplace.issue.dto.IssuePriorities;
import com.workplace.issue.dto.IssueResponse;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.dto.IssueTypeSummary;
import com.workplace.issue.dto.ParentRef;
import com.workplace.issue.dto.ProjectStatusRow;
import com.workplace.issue.dto.UpdateIssueRequest;
import com.workplace.issue.exception.EpicCannotHaveParentException;
import com.workplace.issue.exception.EpicHasIncompleteChildrenException;
import com.workplace.issue.exception.InvalidAssigneeForProjectException;
import com.workplace.issue.exception.InvalidIssueDateRangeException;
import com.workplace.issue.exception.InvalidParentException;
import com.workplace.issue.exception.InvalidStatusForProjectException;
import com.workplace.issue.exception.InvalidTypeForProjectException;
import com.workplace.issue.exception.IssueConflictException;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.exception.ParentCannotBeSubtaskException;
import com.workplace.issue.exception.ParentNotAllowedException;
import com.workplace.issue.exception.RequestedStatusNotFoundException;
import com.workplace.issue.exception.SubtaskParentCannotBeEpicException;
import com.workplace.issue.exception.SubtaskParentRequiredException;
import com.workplace.issue.outbound.IssueChangeNotifier;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueCreatedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssuePriorityChangedEvent;
import com.workplace.issue.outbound.IssueDomainEvents.IssueStatusChangedEvent;
import com.workplace.issue.repository.IssueAiSummaryRepository;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueAttachmentRepository;
import com.workplace.issue.repository.IssueCommentRepository;
import com.workplace.issue.repository.IssueComponentRepository;
import com.workplace.issue.repository.IssueCycleRepository;
import com.workplace.issue.repository.IssueDependencyRepository;
import com.workplace.issue.repository.IssueFieldValueRepository;
import com.workplace.issue.repository.IssueHistoryRepository;
import com.workplace.issue.repository.IssueLabelRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.repository.IssueTypeRepository;
import com.workplace.issue.repository.ProjectStatusRepository;
import com.workplace.label.exception.InvalidLabelForProjectException;
import com.workplace.label.repository.LabelRepository;
import com.workplace.label.service.LabelService;
import com.workplace.milestone.service.MilestoneService;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectAccessGuard;
import com.workplace.user.dto.AssigneeInfo;
import com.workplace.user.repository.UserRepository;
import com.workplace.version.repository.VersionRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.stream.Collectors;
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
  private final IssueBodyImageService bodyImageService;
  private final IssueCommentRepository commentRepository;
  private final IssueCommentReactionService commentReactionService;
  private final IssueHistoryRepository historyRepository;
  private final IssueLabelRepository issueLabelRepository;
  private final IssueAttachmentRepository issueAttachmentRepository;

  /** WP-422: 생성 요청의 스테이징 첨부를 같은 트랜잭션에서 묶는다. */
  private final IssueAttachmentService issueAttachmentService;

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
  private final MilestoneService milestoneService;
  private final IssueChangeNotifier changeNotifier;
  // WP-377: 상세 요약에 진행 중 AI 작업을 싣는다.
  private final AgentWorkService agentWorkService;

  /** WP-356: 생성 시 라벨·사이클 소속 검증과 연결. */
  private final LabelRepository labelRepository;

  /** WP-394: 이름 라벨 확보(없으면 같은 트랜잭션에서 생성). */
  private final LabelService labelService;

  private final CycleRepository cycleRepository;
  private final IssueCycleRepository issueCycleRepository;

  /** AI 즉시 컨텍스트: 저장 요약 조회. */
  private final IssueAiSummaryRepository aiSummaryRepository;

  /** AI 즉시 컨텍스트: 블로커 결정적 계산기 (새 쿼리 0). */
  private final IssueBlockerCalculator blockerCalculator;

  /** WP-807: 프로젝트 상태 해석(상태 id 검증·범주 기본 상태). */
  private final ProjectStatusRepository projectStatusRepository;

  /** 이슈 사이 관계(WP-887) — 상세의 관계 목록과 관계 이력 가림. */
  private final IssueRelationService relationService;

  /** 외부 링크(WP-887) — 상세의 외부 링크 목록. */
  private final IssueExternalLinkService externalLinkService;

  /** 구성요소(WP-933) — 생성 시 소속·보관 검증, 응답의 구성요소 요약. */
  private final ComponentRepository componentRepository;

  /** 구성요소(WP-933) — 자동 지정 담당자 유효성(멤버·활성·사람) 판정. */
  private final ComponentService componentService;

  /** 구성요소(WP-933) — 생성 시 이슈 ↔ 구성요소 연결. */
  private final IssueComponentRepository issueComponentRepository;

  private final VersionRepository versionRepository;

  /** 해석된 프로젝트 상태(WP-807) — 이슈에 쓸 상태 id·범주·이름·색(WP-870, 생성 응답을 재조회 없이 채운다). */
  record ResolvedStatus(long id, String category, String name, String color) {

    static ResolvedStatus of(ProjectStatusRow row) {
      return new ResolvedStatus(row.id(), row.category(), row.name(), row.color());
    }
  }

  /**
   * 요청의 상태 지정을 프로젝트 상태 하나로 해석한다(WP-807). statusId 가 범주보다 우선한다 — 다른 프로젝트 상태이거나 없으면 400(없으면
   * STATUS_NOT_FOUND 코드). 확인을 지난 뒤 상태 삭제가 커밋돼 쓰기가 FK 로 실패하는 경합만 공용 처리기가 409 STATUS_DELETED 로
   * 바꾼다(WP-936). 범주만 오면 이슈가 이미 그 범주일 때 지금 상태를 유지하고(시스템 전이 「진행 중으로」가 「검토 중」을 되돌리지 않게), 아니면 범주 기본
   * 상태(가장 앞)로 간다. 둘 다 없으면 지금 상태(새 이슈면 할 일 기본 상태).
   *
   * @param requested statusId 로 읽은 상태 행({@link #lookupStatus}) — statusId 가 null 이면 빈 값
   * @param before 수정 전 이슈(생성이면 null)
   */
  private ResolvedStatus resolveStatus(
      ProjectRow project,
      Long statusId,
      Optional<ProjectStatusRow> requested,
      String category,
      IssueRow before) {
    if (statusId != null) {
      // 상태가 아예 없으면(요청 전에 삭제됨 — 웹 목록이 낡음) 코드를 실은 400 으로 알려 웹이 상태 목록을 다시 받게 한다(WP-936).
      // 다른 프로젝트의 상태는 예전처럼 코드 없는 400.
      ProjectStatusRow row = requested.orElseThrow(RequestedStatusNotFoundException::new);
      if (!row.projectId().equals(project.id())) throw new InvalidStatusForProjectException();
      return ResolvedStatus.of(row);
    }
    String target =
        category != null ? category : (before != null ? before.status() : IssueStatuses.TODO);
    if (before != null && target.equals(before.status())) {
      return new ResolvedStatus(
          before.statusId(), before.status(), before.statusName(), before.statusColor());
    }
    return projectStatusRepository
        .findDefault(project.id(), target)
        .map(ResolvedStatus::of)
        .orElseThrow(() -> new IllegalStateException("프로젝트에 " + target + " 범주 상태가 없음"));
  }

  /** 요청의 상태 id 를 한 번만 읽는다 — 수정 경로는 잠금 순서 판정과 상태 해석이 같은 행을 쓴다. statusId 가 null 이면 빈 값. */
  private Optional<ProjectStatusRow> lookupStatus(Long statusId) {
    return statusId != null ? projectStatusRepository.findById(statusId) : Optional.empty();
  }

  /**
   * 상태 이름을 해석한 수정 요청과 그 요청의 statusId 행(WP-870) — 이름으로 찾은 상태는 이미 읽은 행을 그대로 실어 다시 읽지 않는다.
   *
   * @param status 요청 statusId 의 상태 행 — statusId 가 null 이면 빈 값
   */
  private record RequestedStatus(UpdateIssueRequest req, Optional<ProjectStatusRow> status) {}

  /** 이름 해석이 행을 주지 않은 요청 — statusId 가 있으면 그 행을 한 번 읽어 함께 싣는다. */
  private RequestedStatus withLookedUpStatus(UpdateIssueRequest req) {
    return new RequestedStatus(req, lookupStatus(req.statusId()));
  }

  /**
   * 신규 이슈 생성. priority 기본값(MID)을 서비스에서 보정. assigneeIds 가 비어있지 않으면 issue_assignee 매핑까지 동시 INSERT.
   * typeId 미지정 시 프로젝트의 TASK 시스템 유형으로 fallback. SUBTASK 면 parentNumber 필수 + 부모 검증, 비SUBTASK 면
   * parentNumber 지정 불가 (Phase 4a).
   */
  public IssueResponse create(Long callerId, String projectKey, CreateIssueRequest req) {
    CreateIssuePlan plan = lockComponentsForShare(planCreate(callerId, projectKey, req), false);
    var project = plan.project();
    IssueRow parent = lockParentForShare(plan);
    if (parent != null) {
      // 잠근 뒤의 최신 부모로 「완료 에픽에는 미완료 하위 불가」를 다시 본다(WP-771) — 에픽 완료가 먼저 잠금을 쥐고 있었으면 planCreate 는 완료 전
      // 상태를 보고 통과해, 완료 에픽 아래 미완료 하위가 남았다.
      requireOpenChildAllowed(
          parent,
          "EPIC".equals(typeRepository.findById(parent.typeId()).orElseThrow().name()),
          plan.status().category());
    }

    // WP-933 구성요소 담당자 자동 지정 — 담당자를 고르지 않았을 때만. 일반 담당자와 같은 목록으로 finishCreate 에 넘겨 매핑·워처·이벤트·
    // 알림·AI 작업 경로를 그대로 탄다. planCreate 는 읽기 전용 사전검증과 공유해 멤버 행을 잠글 수 없으므로 여기서 정한다. 가져오기는 create 를
    // 거치지 않아 자동 지정이 없다.
    AutoAssignment auto = plan.assigneeIds().isEmpty() ? pickComponentAssignee(plan) : null;
    List<Long> assigneeIds = auto == null ? plan.assigneeIds() : List.of(auto.assignee().id());
    List<AssigneeInfo> assignees = auto == null ? plan.assignees() : List.of(auto.assignee());

    int number = sequenceRepository.allocateNext(project.id());
    IssueRow row = insertFromPlan(plan, number, req, callerId, null);
    linkLabelsAndCycles(callerId, row.id(), plan);
    if (auto != null) {
      // 지금은 생성 때 담당자 이력을 남기지 않지만, 자동 지정은 사람이 고른 게 아니라 이유를 남긴다(설계 §4.3).
      historyRecorder.recordComponentDefaultAssigned(
          callerId,
          row.id(),
          auto.assignee().toSummary(),
          auto.component().id(),
          auto.component().name());
    }
    // WP-199 본문 이미지 연결 — 생성 권한(planCreate)을 통과한 뒤라 별도 가드 없이 같은 트랜잭션에서 연결한다.
    // 이미지 참조가 없는 본문(대부분)은 syncIssueImages 가 쿼리 없이 돌아간다.
    bodyImageService.syncIssueImages(project, row.id(), callerId, null, req.body());
    // WP-422 스테이징 첨부 — 같은 트랜잭션에서 묶는다(실패하면 이슈도 롤백). 작업 쓰기 알림(updated)은 내지 않고 아래 finishCreate 의
    // 생성 알림(created)만 나가므로, 수행 도구(MCP) 경유 생성이 첨부 때문에 담당 AI 작업을 시작하지 않는다.
    if (req.fileIds() != null && !req.fileIds().isEmpty()) {
      issueAttachmentService.attachStaged(project, row.id(), callerId, req.fileIds());
    }
    return finishCreate(callerId, project, row, number, assigneeIds, assignees, plan.components());
  }

  /** 구성요소 자동 지정 결과 — 붙일 담당자와, 그 담당자를 준 구성요소(이력의 이유). */
  private record AutoAssignment(AssigneeInfo assignee, ComponentRow component) {}

  /**
   * 고른 구성요소를 목록 순서로 보아 처음으로 유효한 담당자(멤버·활성·사람)를 가진 구성요소의 담당자 — 없으면 null. 보관된 구성요소는 planCreate 가 이미
   * 거절했지만, 쓰지 않는다는 규칙을 여기서도 지킨다. 멤버 행을 공유 잠금한 채 판정해, 동시에 들어온 멤버 제거와 겹쳐 비멤버 담당자가 남지 않게 한다(일반 담당자 지정의
   * WP-775 와 같은 규칙).
   */
  private AutoAssignment pickComponentAssignee(CreateIssuePlan plan) {
    var project = plan.project();
    // 후보(보관 안 된 구성요소의 기본 담당자)를 목록 순서로 모아, 멤버 잠금·유효 판정·담당자 정보 조회를 한 번씩만 한다.
    List<ComponentRow> candidates =
        plan.components().stream()
            .filter(c -> !c.archived() && c.defaultAssigneeId() != null)
            .toList();
    if (candidates.isEmpty()) return null;
    List<Long> userIds =
        candidates.stream().map(ComponentRow::defaultAssigneeId).distinct().toList();
    memberRepository.lockMemberUserIds(project.id(), userIds);
    Map<Long, AssigneeInfo> valid = componentService.validAssignees(project, userIds);
    for (ComponentRow c : candidates) {
      AssigneeInfo info = valid.get(c.defaultAssigneeId());
      if (info != null) return new AutoAssignment(info, c);
    }
    return null;
  }

  /**
   * 고른 구성요소 행을 공유 잠금한 채 다시 읽어 계획을 갱신한다 — planCreate 는 읽기 전용 사전검증과 공유해 잠그지 못하므로, 보관·삭제와 겹쳐 「보관된
   * 구성요소가 새로 붙거나」 「지워진 구성요소의 외래키 위반이 일반 409 로 나가는」 일이 없게 쓰는 쪽(일반 생성·가져오기)이 따로 부른다. 잠그고 읽은 최신 행으로 보관
   * 여부·기본 담당자도 다시 보게 된다. 잠금 순서는 부모 이슈 → 구성요소 행이다(구성요소 보관·삭제는 구성요소 행만 잡아 고리가 생기지 않는다).
   *
   * @param importing 가져오기면 보관된 구성요소도 허용(지난 기록)
   */
  CreateIssuePlan lockComponentsForShare(CreateIssuePlan plan, boolean importing) {
    if (plan.components().isEmpty()) return plan;
    List<Long> ids = plan.components().stream().map(ComponentRow::id).toList();
    List<ComponentRow> locked = componentRepository.findByIds(plan.project().id(), ids, true);
    ComponentService.requireAttachable(locked, ids.size(), importing);
    return plan.withComponents(locked);
  }

  /**
   * 부모가 지금도 살아 있는지 공유 잠금으로 다시 읽는다(WP-759) — 사전검증과 공유하는 planCreate 는 읽기 전용이라 잠글 수 없다. 에픽 삭제와 겹치면 삭제
   * 커밋을 기다렸다가 거절해, 지워진 에픽 아래에 새 이슈가 남지 않게 한다. 일반 생성·가져오기가 함께 쓴다.
   *
   * @return 잠근 부모 행(부모 없는 이슈면 null) — 일반 생성은 이것으로 완료 에픽 규칙을 다시 본다
   */
  IssueRow lockParentForShare(CreateIssuePlan plan) {
    if (plan.parentIssueId() == null) return null;
    return issueRepository
        .findActiveByIdForShare(plan.parentIssueId())
        .orElseThrow(() -> new InvalidParentException("부모로 지정한 이슈를 찾을 수 없습니다"));
  }

  /**
   * 검증을 마친 계획(plan)과 요청으로 이슈 행을 INSERT 한다 — 일반 생성·가져오기가 같은 열 매핑(제목 정리·우선순위 기본값·처음 상태)을 쓰게 한 곳에 둔다.
   * 보고자는 일반 생성이면 호출자, 가져오기면 원래 보고자다. marks 는 가져오기 표시(원 시각·원본 키, 일반 생성은 null).
   */
  IssueRow insertFromPlan(
      CreateIssuePlan plan,
      int number,
      CreateIssueRequest req,
      Long reporterId,
      IssueRepository.ImportMarks marks) {
    IssueRow row =
        issueRepository.insert(
            plan.project().id(),
            number,
            normalizeTitle(req.title()),
            req.body(),
            req.priority() != null ? req.priority() : IssuePriorities.DEFAULT,
            req.dueDate(),
            reporterId,
            plan.typeId(),
            plan.parentIssueId(),
            req.startDate(),
            plan.milestoneId(),
            plan.status().category(),
            plan.status().id(),
            plan.status().name(),
            plan.status().color(),
            plan.milestoneName(),
            marks);
    // WP-1017 에픽이면 프로젝트에서 가장 덜 쓰인 색을 붙인다. 일반 생성은 번호 할당(allocateNext)이 프로젝트 시퀀스 행을 커밋까지 잠가 같은
    // 프로젝트의 생성이 줄을 서므로, 동시에 만든 두 에픽이 같은 「덜 쓰인 색」을 읽지 않는다. 가져오기도 이 경로를 탄다(원본 에픽 색은 옮기지 않는다).
    return plan.epic() ? assignEpicColor(row, null) : row;
  }

  /**
   * 이슈에 자동 에픽 색을 정해 저장하고 그 색을 실은 사본을 돌려준다(WP-1017). excludeIssueId 는 사용 수에서 뺄 이슈(유형 변경으로 에픽이 되는 이슈
   * 자신) — 새 이슈는 아직 색이 없어 null 이어도 같다.
   */
  private IssueRow assignEpicColor(IssueRow row, Long excludeIssueId) {
    String color =
        EpicColors.pickLeastUsed(issueRepository.countEpicColors(row.projectId(), excludeIssueId));
    issueRepository.updateEpicColor(row.id(), color);
    return row.withEpicColor(color);
  }

  /**
   * WP-356 라벨·사이클 연결 — 검증(planCreate)을 통과한 id 만 같은 트랜잭션에서 붙인다. 새 이슈라 diff·이력 없이 추가만 한다. WP-394 이름
   * 라벨은 여기서 없는 것을 만들어 id 로 합친다 — 이슈 생성과 한 트랜잭션이라 뒤에서 실패하면 라벨도 롤백된다. 일반 생성·가져오기가 함께 쓴다.
   */
  void linkLabelsAndCycles(Long callerId, long issueId, CreateIssuePlan plan) {
    for (Long labelId :
        labelService.mergeWithNames(plan.project(), callerId, plan.labelIds(), plan.labelNames())) {
      issueLabelRepository.add(issueId, labelId);
    }
    for (Long cycleId : plan.cycleIds()) {
      issueCycleRepository.add(issueId, cycleId);
    }
    // WP-933 구성요소 — 라벨처럼 새 이슈라 이력 없이 추가만 한다.
    for (ComponentRow c : plan.components()) {
      issueComponentRepository.add(issueId, c.id());
    }
  }

  /**
   * 이슈 생성 사전검증(dry-run) 진입점 (#842). 쓰기(시퀀스 발급·INSERT) 직전까지의 모든 검증을 수행하되 아무것도 쓰지 않는다 — 확인 카드가 승인 전에
   * 실패를 드러내기 위함. {@link #create} 와 동일한 {@link #planCreate} 를 호출하므로 술어가 두 벌이 되지 않는다.
   *
   * @throws ProjectAccessDeniedException 프로젝트 접근 불가(또는 ProjectNotFoundException)
   * @throws InvalidAssigneeForProjectException 담당자가 프로젝트 멤버가 아님
   * @throws InvalidTypeForProjectException typeId 가 없거나 다른 프로젝트 소속
   * @throws EpicCannotHaveParentException EPIC 에 parentNumber 지정
   * @throws InvalidParentException 부모 이슈/유형 없음
   * @throws ParentCannotBeSubtaskException SUBTASK 의 부모가 SUBTASK
   * @throws SubtaskParentCannotBeEpicException SUBTASK 의 부모가 EPIC
   * @throws ParentNotAllowedException 일반 이슈의 부모가 EPIC 이 아님
   * @throws SubtaskParentRequiredException SUBTASK 인데 parentNumber 누락
   * @throws InvalidIssueDateRangeException 시작일 > 마감일
   * @throws InvalidLabelForProjectException 라벨이 없거나 다른 프로젝트 소속(WP-356)
   * @throws InvalidCycleForProjectException 사이클이 없거나 다른 프로젝트 소속(WP-356)
   */
  @Transactional(readOnly = true)
  public void validateCreatable(Long callerId, String projectKey, CreateIssueRequest req) {
    planCreate(callerId, projectKey, req);
  }

  /**
   * 이슈 생성 검증 + 해석 결과 묶음. 검증 도중 계산되는 값(프로젝트 행·담당자·typeId·부모 id)을 담아 실행 경로가 같은 계산을 다시 하지 않도록 한다 —
   * 사전검증과 실행이 술어를 공유하게 만드는 핵심 (#842).
   */
  record CreateIssuePlan(
      ProjectRow project,
      List<Long> assigneeIds,
      List<AssigneeInfo> assignees,
      Long typeId,
      Long parentIssueId,
      List<Long> labelIds,
      Long milestoneId,
      // 검증하며 읽은 마일스톤 이름(WP-870) — INSERT 뒤 재조회 없이 응답에 싣는다. 마일스톤이 없으면 null.
      String milestoneName,
      List<Long> cycleIds,
      List<String> labelNames,
      // WP-807 처음 상태 — statusId 우선, 범주만 오면 그 범주 기본 상태.
      ResolvedStatus status,
      // WP-933 고른 구성요소(목록 순서) — 연결과 담당자 자동 지정이 쓴다. 없으면 빈 목록.
      List<ComponentRow> components,
      // WP-1017 만드는 이슈가 에픽인지 — INSERT 때 에픽 색을 정한다(유형을 다시 읽지 않게 검증하며 본 값을 싣는다).
      boolean epic) {
    /** 구성요소만 바꾼 사본 — 잠그고 다시 읽은 행으로 갈아 끼울 때 쓴다. */
    CreateIssuePlan withComponents(List<ComponentRow> newComponents) {
      return new CreateIssuePlan(
          project,
          assigneeIds,
          assignees,
          typeId,
          parentIssueId,
          labelIds,
          milestoneId,
          milestoneName,
          cycleIds,
          labelNames,
          status,
          newComponents,
          epic);
    }
  }

  /**
   * 생성 검증 방식 — NORMAL 은 일반 생성·사전검증, IMPORT 는 이슈 가져오기(WP-883). IMPORT 는 원본을 그대로 옮기는 데 방해되는 두 규칙만
   * 건너뛴다 — 완료 사이클에 넣기 거절과 완료 에픽 아래 미완료 하위 거절. 다른 트래커에서는 둘 다 흔한 상태라 막으면 이관한 이슈가 원본과 달라진다. 나머지 검증(소속·
   * 유형·부모 모양·날짜 등)은 같다.
   */
  enum CreateMode {
    NORMAL,
    IMPORT
  }

  /** 생성 술어 본체 — 쓰기 없이 검증만 수행하고 실행에 필요한 해석값을 반환한다. 예외 종류·순서는 기존 create 와 동일. */
  CreateIssuePlan planCreate(Long callerId, String projectKey, CreateIssueRequest req) {
    return planCreate(callerId, projectKey, req, CreateMode.NORMAL);
  }

  /**
   * {@link #planCreate(Long, String, CreateIssueRequest)} 와 같은 검증이되, mode 가 IMPORT 면 {@link
   * CreateMode} 의 두 규칙을 건너뛴다.
   */
  CreateIssuePlan planCreate(
      Long callerId, String projectKey, CreateIssueRequest req, CreateMode mode) {
    boolean importing = mode == CreateMode.IMPORT;
    // OPEN 프로젝트는 테넌트 전원이 이슈를 생성할 수 있다(assertIssueCreatable). TEAM/PERSONAL 은 멤버만.
    var project = accessGuard.assertIssueCreatable(projectKey, callerId);
    boolean memberOrAdmin = accessGuard.isMemberOrAdmin(project, callerId);

    // 0) OPEN 프로젝트 비멤버의 멤버 전용 값(WP-477) — 우선순위·시작일·마감일·담당자·유형·부모는 수정 경로에서 멤버 전용이라, 생성이 그 변경의
    //    우회로가 되면 안 된다. 접수 분류(유형·우선순위·일정·담당)는 처리팀 몫이다. 기본값(우선순위 MID·유형 TASK)·빈 담당자는 지정하지 않은 것과
    //    같아 받아 준다. 다른 검증보다 먼저 막아, 비멤버는 담당자·부모의 존재 여부도 알 수 없다.
    if (!memberOrAdmin && specifiesMemberOnlyFields(project, req)) {
      throw new ProjectAccessDeniedException("우선순위·일정·담당자·유형·부모는 프로젝트 멤버만 지정할 수 있습니다");
    }

    // 0-1) 처음 상태(WP-807) — 다른 프로젝트·없는 상태 id 는 400. 부모 검증(완료 에픽 아래 미완료 하위 금지)이 해석된 범주를 쓴다.
    ResolvedStatus status =
        resolveStatus(project, req.statusId(), lookupStatus(req.statusId()), req.status(), null);

    // 1) 담당자 검증 — 개인·팀 공통으로 프로젝트 멤버만 담당 가능 (정책 통일 #418)
    List<Long> assigneeIds = req.assigneeIds() == null ? List.of() : req.assigneeIds();
    List<AssigneeInfo> assignees = List.of();
    if (!assigneeIds.isEmpty()) {
      AssigneePolicy.requireMembers(project, assigneeIds, memberRepository);
      // 담당자는 이 워크스페이스에서 활성이어야 한다(전역 비활성·WP-417 정지 거부) — 담당자 교체와 같은 규칙(AssigneePolicy). 읽은 정보는
      // 실행 후속부(작업 생성·이벤트 요약)가 그대로 재사용한다.
      assignees = userRepository.findAssigneeInfos(assigneeIds, TenantContext.get());
      AssigneePolicy.requireActive(assignees);
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
              .orElseThrow(() -> new InvalidParentException("부모로 지정한 이슈를 찾을 수 없습니다"));
      var parentType =
          typeRepository
              .findById(parent.typeId())
              .orElseThrow(() -> new InvalidParentException("부모로 지정한 이슈의 유형을 확인할 수 없습니다"));
      boolean parentIsSubtask = "SUBTASK".equals(parentType.name());
      boolean parentIsEpic = "EPIC".equals(parentType.name());
      if (isSubtask) {
        if (parentIsSubtask) throw new ParentCannotBeSubtaskException();
        if (parentIsEpic) throw new SubtaskParentCannotBeEpicException();
      } else if (!parentIsEpic) {
        throw new ParentNotAllowedException();
      }
      if (!importing) requireOpenChildAllowed(parent, parentIsEpic, status.category());
      parentIssueId = parent.id();
    } else if (isSubtask) {
      throw new SubtaskParentRequiredException();
    }

    // 4) 시작일 검증 — 시작일이 마감일보다 늦을 수 없다(타임라인 간트뷰 정합성).
    if (req.startDate() != null
        && req.dueDate() != null
        && req.startDate().isAfter(req.dueDate())) {
      throw new InvalidIssueDateRangeException(req.startDate(), req.dueDate());
    }

    // 5) 라벨·마일스톤·사이클(WP-356) — 수정 경로와 같은 규칙: 멤버(또는 ADMIN)만 지정할 수 있고 모두 같은 프로젝트 소속이어야 한다.
    //    OPEN 프로젝트의 비멤버도 이슈는 만들 수 있지만, 생성이 라벨·마일스톤·사이클 변경(멤버 전용)의 우회로가 되면 안 된다.
    //    사이클은 집합 교체(IssueCycleService.replace)처럼 완료 사이클도 허용한다.
    List<Long> labelIds = distinct(req.labelIds());
    List<Long> cycleIds = distinct(req.cycleIds());
    // WP-933 구성요소도 같은 멤버 전용 값 — 비구성원이 넘기면 자동 지정의 우회로가 되므로 라벨과 함께 막는다.
    List<Long> componentIds = distinct(req.componentIds());
    // WP-394 이름 라벨 — 여기선 모양만 검증(쓰기 없음, 사전검증과 공유). 없는 라벨 생성은 create 실행 때.
    List<String> labelNames = LabelService.normalizeNames(req.labelNames());
    if ((!labelIds.isEmpty()
            || !labelNames.isEmpty()
            || !cycleIds.isEmpty()
            || !componentIds.isEmpty()
            || req.milestoneId() != null)
        && !memberOrAdmin) {
      throw new ProjectAccessDeniedException("라벨·마일스톤·사이클·구성요소는 프로젝트 멤버만 지정할 수 있습니다");
    }
    if (!labelIds.isEmpty()) {
      var labels = labelRepository.findByIds(labelIds);
      if (labels.size() != labelIds.size()
          || labels.stream().anyMatch(l -> !l.projectId().equals(project.id()))) {
        throw new InvalidLabelForProjectException();
      }
    }
    var milestone =
        req.milestoneId() == null
            ? null
            : milestoneService.loadInProject(req.milestoneId(), project.id());
    if (!cycleIds.isEmpty()) {
      var cycles = cycleRepository.findByIds(cycleIds);
      if (cycles.size() != cycleIds.size()
          || cycles.stream().anyMatch(c -> !c.projectId().equals(project.id()))) {
        throw new InvalidCycleForProjectException();
      }
      // 완료 사이클에는 새 이슈를 넣지 않는다 — 사이클 피커(replace)·보드 드래그(move)와 같은 규칙(WP-659). 가져오기는 원본 그대로 넣는다.
      if (!importing && cycles.stream().anyMatch(c -> CycleStatus.COMPLETED.equals(c.status()))) {
        throw new CompletedCycleNotAssignableException();
      }
    }

    // WP-933 구성요소 — 모두 이 프로젝트 소속이어야 하고(400), 보관된 것은 새로 붙일 수 없다. 가져오기는 지난 기록이라 보관된 것도 허용한다.
    List<ComponentRow> components =
        componentRepository.findByIds(project.id(), componentIds, false);
    ComponentService.requireAttachable(components, componentIds.size(), importing);

    return new CreateIssuePlan(
        project,
        assigneeIds,
        assignees,
        typeId,
        parentIssueId,
        labelIds,
        milestone == null ? null : milestone.id(),
        milestone == null ? null : milestone.name(),
        cycleIds,
        labelNames,
        status,
        components,
        isEpic);
  }

  /**
   * 요청이 기본값이 아닌 멤버 전용 값(우선순위≠MID·상태≠TODO(상태 id≠할 일 기본 상태)·날짜·담당자·유형≠TASK·부모)을 지정했는지 — WP-477 비멤버 생성
   * 검사.
   */
  private boolean specifiesMemberOnlyFields(ProjectRow project, CreateIssueRequest req) {
    if (req.priority() != null && !IssuePriorities.DEFAULT.equals(req.priority())) return true;
    // 처음 상태(WP-464)도 상태 변경처럼 멤버 전용 — 할 일은 기본값과 같다.
    if (req.status() != null && !IssueStatuses.TODO.equals(req.status())) return true;
    // 상태 id(WP-807)도 할 일 기본 상태가 아니면 멤버 전용 — 범주 TODO 의 다른 상태도 상태 지정이다.
    if (req.statusId() != null
        && !projectStatusRepository
            .findDefault(project.id(), IssueStatuses.TODO)
            .map(d -> d.id().equals(req.statusId()))
            .orElse(false)) {
      return true;
    }
    if (req.startDate() != null || req.dueDate() != null || req.parentNumber() != null) return true;
    if (req.assigneeIds() != null && !req.assigneeIds().isEmpty()) return true;
    return req.typeId() != null
        && typeRepository
            .findById(req.typeId())
            .map(t -> !t.projectId().equals(project.id()) || !"TASK".equals(t.name()))
            .orElse(true);
  }

  /** null·중복을 걸러 순서를 지킨 목록으로 — 같은 id 를 두 번 주면 소속 검증의 개수 비교가 어긋나므로. */
  private static List<Long> distinct(List<Long> ids) {
    return ids == null ? List.of() : List.copyOf(new LinkedHashSet<>(ids));
  }

  /** 생성 실행 후속부 — 담당자 매핑·워처 등록·도메인 이벤트 발행. 검증은 planCreate 가 이미 끝냈다. */
  private IssueResponse finishCreate(
      Long callerId,
      ProjectRow project,
      IssueRow row,
      int number,
      List<Long> assigneeIds,
      List<AssigneeInfo> assignees,
      List<ComponentRow> components) {
    // 3) issue_assignee 매핑 INSERT
    for (Long uid : assigneeIds) {
      assigneeRepository.add(row.id(), uid, callerId);
    }
    // 담당자 사용자 정보(planCreate 가 한 번 읽음)를 시작 전 작업 판별과 이벤트용 요약에 함께 쓴다.
    // 외부 실행 AI 구성원이 담당자로 들어오면 "시작 전" 작업을 만든다(WP-377). 종료 상태로 만든 이슈에는 만들지 않는다.
    agentWorkService.submitForAssignees(row.id(), row.status(), assignees);

    // 4) watcher 자동 등록: reporter + 각 assignee (caller 와 다를 때만)
    watcherAutoEnroller.enroll(project, row.id(), callerId, callerId);
    for (Long uid : assigneeIds) {
      if (!uid.equals(callerId)) watcherAutoEnroller.enroll(project, row.id(), uid, callerId);
    }

    // 5) 도메인 이벤트 발행 (AFTER_COMMIT 리스너들이 처리)
    //    - IssueCreatedEvent 는 항상 발행 (assignee 가 비어있어도)
    //    - assignee 가 있으면 initial 상태로 IssueAssignedEvent 도 함께 발행 (added=all, removed=[])
    //    - WP-253: ai-agent 디스패처는 IssueAssignedEvent 만 발사한다(AI 실행 1회). 그래서 담당자가 있는 생성에서
    //      assigned 발행을 빼면 AGENT 담당 이슈가 AI 에 전달되지 않는다 — 이 불변식을 유지할 것.
    var actor =
        userRepository
            .findById(callerId)
            .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
            .orElse(null);
    List<UserSummary> assigneeSummaries = assignees.stream().map(AssigneeInfo::toSummary).toList();
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
    changeNotifier.created(project, number, row.id(), callerId);
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

    // 6) 응답에 유형·담당자·부모·라벨을 채운다(#877) — 부분 응답(from)이면 저장은 됐어도 호출자(MCP create_issue 등)가 미반영으로 오판한다.
    //    새 이슈라 첨부·커스텀 필드는 없다.
    // 수행 도구 헤더가 있는 생성이면 알림의 AI 작업 자동 시작이 이슈를 진행 중으로 올렸을 수 있다(WP-393) — 응답의 상태·버전이 저장된 값과
    // 어긋나지 않게 그때만 다시 읽는다(브라우저 생성은 자동 시작이 없다). WP-870 에서 INSERT 뒤 재조회는 없앴지만 이 재조회는 이름을 채우려는
    // 것이 아니라 생성 뒤 바뀐 상태를 반영하려는 것이라 그대로 둔다.
    var saved =
        AgentToolContext.current() == null ? row : issueRepository.findById(row.id()).orElse(row);
    return newIssueSummary(
        project,
        saved,
        assigneeSummaries,
        0,
        List.of(),
        components.stream().map(ComponentRow::toSummary).toList());
  }

  /**
   * 방금 만든 이슈의 요약 응답 — 유형·부모·라벨을 읽어 채운다. 새 이슈라 자식·의존성은 없으므로 상세 조회(get)처럼 댓글·이력까지 다시 읽지 않는다. 일반
   * 생성(첨부·필드 없음)과 가져오기(원 첨부 수·필드 값)가 함께 쓴다. 라벨은 생성 때 붙였을 수 있다(WP-356, 없으면 빈 목록). 구성요소는 호출부가 붙인
   * 행(잠가서 읽은 계획의 구성요소)으로 넘겨 다시 읽지 않는다.
   */
  IssueResponse newIssueSummary(
      ProjectRow project,
      IssueRow row,
      List<UserSummary> assignees,
      int attachmentCount,
      List<IssueFieldEntry> customFields,
      List<ComponentSummary> components) {
    var type = typeRepository.findByIds(List.of(row.typeId())).get(row.typeId());
    var parentRef =
        row.parentIssueId() == null
            ? null
            : issueRepository.findParentRefsByIssueIds(List.of(row.id())).get(row.id());
    var labels = issueLabelRepository.findLabelsByIssue(row.id());
    return IssueResponse.fromWithCustomFields(
            project.key(),
            row,
            labels,
            attachmentCount,
            type,
            assignees,
            parentRef,
            0,
            0,
            List.of(),
            List.of(),
            false,
            customFields)
        .withComponents(components);
  }

  /** 한 이슈에 붙은 구성요소 요약(목록 순서, WP-933) — 없으면 빈 목록. */
  private List<ComponentSummary> componentsOf(long issueId) {
    return componentRepository.summariesByIssue(issueId);
  }

  /** 한 이슈에 붙은 수정·영향 버전 요약(목록 순서, 한 쿼리, WP-888) — 없으면 빈 쌍. */
  private VersionRepository.IssueVersionSummaries versionsOf(long issueId) {
    return versionRepository
        .summariesByIssueIdsBothKinds(List.of(issueId))
        .getOrDefault(issueId, VersionRepository.IssueVersionSummaries.EMPTY);
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
    // 코멘트마다 보는 사람별 반응 집계를 싣는다(WP-504) — 집계 쿼리 한 번.
    var comments = commentReactionService.enrich(commentRepository.findByIssue(row.id()), callerId);
    // 관계 이력(RELATION_*)은 상대 프로젝트를 읽을 수 없는 조회자에게 상대 키·제목을 가린다(WP-887).
    var history =
        relationService.redactHistory(callerId, project, historyRepository.findByIssue(row.id()));
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
    // WP-888 — 수정·영향 버전을 한 쿼리로 읽는다.
    var versions = versionsOf(row.id());
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
                fieldsByIssue.getOrDefault(row.id(), List.of()))
            .withAgentWork(agentWorkService.viewsByIssueIds(ids).getOrDefault(row.id(), List.of()))
            .withComponents(componentsOf(row.id()))
            .withVersions(versions.fix(), versions.affects());
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
    //   삭제=OWNER or reporter 본인(비멤버 reporter 는 처리팀이 손대기 전까지만 — softDelete 규칙, WP-634).
    boolean memberOrAdmin = accessGuard.isMemberOrAdmin(project, callerId);
    boolean isReporter = row.reporterId() != null && row.reporterId().equals(callerId);
    boolean isOwner = accessGuard.isOwner(project, callerId);
    boolean canWorkflow = memberOrAdmin;
    boolean canContent = memberOrAdmin || ("OPEN".equals(project.type()) && isReporter);
    boolean canDelete =
        isOwner
            || (isReporter
                && (memberOrAdmin
                    || untouchedByTeam(
                        row,
                        !assignees.isEmpty(),
                        comments.stream().anyMatch(c -> !row.reporterId().equals(c.authorId())))));
    // 보고자 요약(WP-272) — 상세 화면이 이름·AI 여부를 그릴 수 있게 한다. 사용자 행이 없으면 null(프론트는 「알 수 없음」).
    UserSummary reporter =
        row.reporterId() == null
            ? null
            : userRepository
                .findById(row.reporterId())
                .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
                .orElse(null);

    return new IssueDetailResponse(
        summaryResponse,
        row.body(),
        comments,
        history,
        attachments,
        aiContext,
        canContent,
        canWorkflow,
        canDelete,
        reporter,
        accessGuard.canChangeReporter(project, row.reporterId(), callerId),
        // 관계(WP-887) — 조회자가 읽을 수 있는 상대만. 외부 링크는 외부 주소라 프로젝트 권한과 무관하게 전부 싣는다.
        relationService.listFor(callerId, row, project),
        externalLinkService.listFor(row.id()));
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
      Long callerId, String projectKey, int number, UpdateIssueRequest rawReq) {
    var project = accessGuard.resolve(projectKey);
    // WP-870 상태 이름은 맨 앞에서 상태 id(범주 코드면 범주)로 바꾼다 — 아래의 잠금 순서·권한·정리성 판정·자동 시작 플래그가 모두
    // status/statusId 만 보므로, 바꾸지 않으면 이름으로 지정한 상태가 명시적 상태 변경으로 취급되지 않는다.
    // 상태 id 지정이면 그 상태 행을 한 번만 읽어(이름으로 찾았으면 그 행 그대로) 잠금 순서 판정과 아래 상태 해석에 함께 쓴다(WP-807).
    RequestedStatus named = resolveStatusName(callerId, projectKey, project, rawReq);
    UpdateIssueRequest req = named.req();
    Optional<ProjectStatusRow> requestedStatus = named.status();
    lockParentIfReopening(project, number, req, requestedStatus);
    // #611 읽은 값에 요청 필드를 병합해 전 컬럼을 다시 쓰므로 행을 잠가 동시 수정이 서로를 되돌리지 않게 한다.
    var before =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
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
              || req.statusId() != null
              || req.priority() != null
              || req.dueDate() != null
              || Boolean.TRUE.equals(req.clearDueDate())
              || req.startDate() != null
              || Boolean.TRUE.equals(req.clearStartDate())
              || req.milestoneId() != null
              || Boolean.TRUE.equals(req.clearMilestone());
      if (touchesWorkflow) {
        throw new ProjectAccessDeniedException("상태·우선순위·마감일은 처리팀(멤버)만 변경할 수 있습니다");
      }
    }

    // #611 클라이언트가 읽은 뒤 다른 편집이 먼저 반영됐으면 덮어쓰지 않고 409 로 알린다.
    if (req.version() != null && req.version() != before.version()) {
      throw new IssueConflictException(project.key() + "-" + number);
    }

    String newTitle = req.title() != null ? normalizeTitle(req.title()) : before.title();
    String newBody = req.body() != null ? req.body() : before.body();
    // WP-807 상태 — statusId 우선, 범주만 오면 이미 그 범주면 유지·아니면 범주 기본 상태. 이하 종료 시각·에픽 차단·AI 작업 종료는 범주로 판정한다.
    ResolvedStatus resolved =
        resolveStatus(project, req.statusId(), requestedStatus, req.status(), before);
    String newStatus = resolved.category();
    String newPriority = req.priority() != null ? req.priority() : before.priority();
    LocalDate newDue =
        Boolean.TRUE.equals(req.clearDueDate())
            ? null
            : (req.dueDate() != null ? req.dueDate() : before.dueDate());
    // 시작일 — dueDate 와 동일한 부분수정 규약(null=미변경, clear 플래그=삭제).
    LocalDate newStart =
        Boolean.TRUE.equals(req.clearStartDate())
            ? null
            : (req.startDate() != null ? req.startDate() : before.startDate());
    if (newStart != null && newDue != null && newStart.isAfter(newDue)) {
      throw new InvalidIssueDateRangeException(newStart, newDue);
    }
    // 마일스톤 — 같은 프로젝트 소속 검증 후 연결(loadInProject 가 격리 보장).
    Long newMilestoneId =
        Boolean.TRUE.equals(req.clearMilestone())
            ? null
            : (req.milestoneId() != null
                ? milestoneService.loadInProject(req.milestoneId(), project.id()).id()
                : before.milestoneId());

    // closed_at 전이: 종료 상태로 진입 시 now(), 재오픈 시 NULL, 그 외 유지
    boolean wasClosed = IssueStatuses.CLOSED.contains(before.status());
    boolean nowClosed = IssueStatuses.CLOSED.contains(newStatus);
    Instant newClosedAt;
    if (nowClosed && !wasClosed) {
      newClosedAt = Instant.now();
    } else if (!nowClosed && wasClosed) {
      newClosedAt = null;
    } else {
      newClosedAt = before.closedAt();
    }

    // EPIC → DONE 전이 시 미완료 자식 이슈가 있으면 하드 차단(#710). silent-cascade 로 EPIC 만 완료 처리되고
    // 자식이 미완료로 남는 불일치 상태를 막는다(#678 커스텀 역할 삭제와 동일한 hard-block 정책, 경고 후 강제진행 옵션은 두지 않음).
    // 자식 유형과 무관하게(SUBTASK 뿐 아니라 TASK 등 전체) 하나라도 미완료면 차단 — 보드 카드의 SUBTASK 전용 집계와는 별개 기준.
    if (IssueStatuses.DONE.equals(newStatus) && !IssueStatuses.DONE.equals(before.status())) {
      var beforeType = typeRepository.findById(before.typeId()).orElseThrow();
      if ("EPIC".equals(beforeType.name())) {
        var incompleteChildNumbers = issueRepository.findIncompleteChildNumbers(before.id());
        if (!incompleteChildNumbers.isEmpty()) {
          throw new EpicHasIncompleteChildrenException(
              "미완료 하위 이슈가 %d건 있어 완료로 변경할 수 없습니다: %s"
                  .formatted(
                      incompleteChildNumbers.size(),
                      incompleteChildNumbers.stream()
                          .map(n -> project.key() + "-" + n)
                          .collect(Collectors.joining(", "))));
        }
      }
    }

    issueRepository.updateAll(
        before.id(),
        newTitle,
        newBody,
        newStatus,
        resolved.id(),
        newPriority,
        newDue,
        newStart,
        newMilestoneId,
        newClosedAt);
    // 종료 상태(DONE/CANCELED)로 진입하면 그 이슈의 진행 중 AI 작업을 전부 끝낸다(WP-377 §4.3).
    // DONE 은 COMPLETED(착수 전 SUBMITTED 만 CANCELED), CANCELED 는 CANCELED 로 닫고, 재오픈은 되살리지 않는다.
    // 알림은 아래 changeNotifier.updated 가 이미 보내므로 여기서는 기록만 닫는다.
    if (nowClosed && !wasClosed) {
      if (IssueStatuses.DONE.equals(newStatus)) {
        agentWorkService.endAllOnIssueDone(List.of(before.id()));
      } else {
        agentWorkService.cancelAllForIssues(List.of(before.id()));
      }
    }
    // WP-199 본문이 바뀐 요청만 이미지 연결 상태를 맞춘다 — 상태·담당자만 바꾸는 PATCH 에서 불필요한 잠금을 잡지 않는다.
    // 새 본문·이전 본문 모두 이미지 참조가 없으면 syncIssueImages 가 추가 쿼리 없이 돌아간다.
    if (req.body() != null) {
      bodyImageService.syncIssueImages(project, before.id(), callerId, before.body(), newBody);
    }
    var after = issueRepository.findById(before.id()).orElseThrow();

    // 상태·우선순위 전이가 있을 때 각각 이벤트 발행 (AFTER_COMMIT 에서 ai-agent/알림 발사 후보).
    // 우선순위는 상태와 대칭적으로 모든 변경에 발행(임계치 조건 없음, #613).
    // 상태는 프로젝트 상태 id 로 비교한다 — 같은 범주 안 이동(진행 중 → 검토 중)도 알림·이력에 남는다(WP-807).
    boolean statusChanged = !Objects.equals(before.statusId(), after.statusId());
    if (statusChanged || !before.priority().equals(after.priority())) {
      var actor =
          userRepository
              .findById(callerId)
              .map(u -> new UserSummary(u.id(), u.username(), u.name(), u.kind()))
              .orElse(null);
      var currentAssignees = assigneeRepository.findByIssue(after.id());
      String issueKey = project.key() + "-" + after.number();

      if (statusChanged) {
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
                before.statusName(),
                after.statusName(),
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

    // 이력을 알림보다 먼저 남긴다 — 알림이 AI 작업 자동 시작으로 상태를 진행 중으로 올리면(WP-393) 그 이력이 이 변경 뒤에 와야 순서가 맞다.
    historyRecorder.recordChanges(callerId, before, after);
    // 실시간 무효화 — 제목·본문·날짜 등 모든 필드 변경을 알린다(목록/상세가 보여주므로). 상태를 직접 지정한 요청이면 자동 시작이 덮지 않는다.
    // 제목·본문·상태 없이 우선순위·날짜·마일스톤만 바꾼 요청은 정리성 쓰기라 AI 작업을 시작·터치하지 않는다(WP-425).
    if (isOrganizingOnly(req)) {
      changeNotifier.updatedWithoutTouch(project, number, before.id(), callerId);
    } else {
      changeNotifier.updated(
          project, number, before.id(), callerId, req.status() != null || req.statusId() != null);
    }
    // WP-689 완료(DONE) 에픽의 하위가 다시 열리면 에픽도 진행 중으로 되돌린다 — 완료 에픽 아래 미완료 하위가 남지 않게.
    // 같은 update 경로로 바꿔 상태 이력·이벤트·실시간 무효화를 그대로 남긴다(에픽은 부모가 없어 더 올라가지 않는다).
    if (wasClosed && !nowClosed && before.parentIssueId() != null) {
      var parent = issueRepository.findById(before.parentIssueId()).orElseThrow();
      // 범주 「진행 중」으로 보내면 resolveStatus 가 그 범주 기본 상태로 옮긴다(사용자 정의 완료 상태 「배포됨」 에픽도 같다, WP-807).
      if (IssueStatuses.DONE.equals(parent.status())
          && "EPIC".equals(typeRepository.findById(parent.typeId()).orElseThrow().name())) {
        updateStatus(callerId, projectKey, parent.number(), IssueStatuses.IN_PROGRESS);
      }
    }

    return get(callerId, projectKey, number);
  }

  /**
   * 끝난 하위를 다시 여는 요청이면 그 부모를 하위보다 먼저 쓰기 잠금한다(WP-771). 다시 연 하위는 완료 에픽도 다시 열어야 하는데(WP-689), 에픽 완료가 동시에
   * 오면 완료 쪽은 하위가 아직 끝난 것으로, 다시 여는 쪽은 에픽이 아직 열린 것으로 보고 둘 다 통과해 완료 에픽 아래 미완료 하위가 남았다. 부모를 먼저 잠그면 늦은
   * 쪽이 앞선 결과를 본다. 순서를 에픽 완료·삭제와 같은 「부모→하위」로 맞춰 서로 기다리지 않게 한다 — 그래서 하위 행을 잠그기 전에, 잠그지 않은 읽기로 대상을
   * 고른다(그 사이 상태·부모가 바뀌면 아래 다시 열기 판정이 잠근 행으로 다시 본다).
   */
  private void lockParentIfReopening(
      ProjectRow project,
      int number,
      UpdateIssueRequest req,
      Optional<ProjectStatusRow> requestedStatus) {
    // 상태 id 로 다시 여는 요청(WP-807)도 같은 잠금 순서를 지키도록 그 상태의 범주로 판정한다(없는 id 는 뒤의 resolveStatus 가 400).
    String target =
        req.statusId() != null
            ? requestedStatus.map(ProjectStatusRow::category).orElse(null)
            : req.status();
    if (target == null || IssueStatuses.isClosed(target)) return;
    issueRepository
        .findByProjectAndNumber(project.id(), number)
        .filter(row -> row.parentIssueId() != null && IssueStatuses.CLOSED.contains(row.status()))
        .ifPresent(row -> issueRepository.lockActiveByIdForUpdate(row.parentIssueId()));
  }

  /**
   * 요청의 상태 이름(WP-870)을 상태 id 또는 범주로 바꾼 요청과 그 statusId 의 상태 행을 돌려준다(이름으로 찾았으면 그 행을 그대로 실어 다시 읽지
   * 않는다). statusId 가 있으면 이름은 무시하고(우선순위 statusId → statusName → status), 이름이 없으면 요청을 그대로 둔다. 이름이 범주
   * 코드(대소문자·앞뒤 공백 무시)면 범주로 본다 — 1차의 「범주가 이름보다 먼저」 규칙이고 상태 이름은 범주 코드와 같을 수 없다. 아니면 프로젝트 상태 중 {@link
   * IssueStatuses#statusNameKey} 가 같은 것을 고르고, 없으면 검색 필터와 같은 문구로 사용 가능 이름을 담아 400.
   */
  private RequestedStatus resolveStatusName(
      Long callerId, String projectKey, ProjectRow project, UpdateIssueRequest req) {
    if (req.statusName() == null) return withLookedUpStatus(req);
    if (req.statusId() != null) {
      return withLookedUpStatus(req.withResolvedStatus(req.status(), req.statusId()));
    }
    String category = req.statusName().strip().toUpperCase(Locale.ROOT);
    if (IssueStatuses.isCategory(category)) {
      return withLookedUpStatus(req.withResolvedStatus(category, null));
    }
    // 볼 수 없는 프로젝트의 상태 이름이 400 메시지로 새지 않게, 이름을 찾기 전에 읽기 권한을 본다(없으면 없는 프로젝트와 같은 404).
    accessGuard.assertReadable(projectKey, callerId);
    List<ProjectStatusRow> statuses = projectStatusRepository.findByProject(project.id());
    String key = IssueStatuses.statusNameKey(req.statusName());
    return statuses.stream()
        .filter(s -> IssueStatuses.statusNameKey(s.name()).equals(key))
        .findFirst()
        .map(s -> new RequestedStatus(req.withResolvedStatus(req.status(), s.id()), Optional.of(s)))
        .orElseThrow(
            () ->
                new InvalidStatusForProjectException(
                    IssueFilterResolver.notFoundMessage(
                        "상태",
                        req.statusName().strip(),
                        statuses.stream().map(ProjectStatusRow::name).toList())));
  }

  /**
   * DnD 등에서 상태만 변경. update(...) 의 단축 경로 — 히스토리 기록도 동일하게 수행. statusId(프로젝트 상태, WP-807)가 있으면 그것이 이기고
   * 범주는 그 상태의 범주를 따른다. 범주만 오면 이미 그 범주일 때 지금 상태를 유지하고 아니면 범주 기본 상태로 간다 — 시스템 전이(AI 작업 시작·에픽 재오픈)가 이
   * 경로라 사용자가 고른 같은 범주 상태를 되돌리지 않는다.
   */
  public IssueDetailResponse updateStatus(
      Long callerId, String projectKey, int number, String category, Long statusId) {
    return updateStatus(callerId, projectKey, number, category, statusId, null);
  }

  /** PATCH /status — 상태 이름(WP-870)까지 받는다. 이름 해석은 {@link #update} 맨 앞에서 한다. */
  public IssueDetailResponse updateStatus(
      Long callerId,
      String projectKey,
      int number,
      String category,
      Long statusId,
      String statusName) {
    return update(
        callerId,
        projectKey,
        number,
        UpdateIssueRequest.statusOnly(category, statusId, statusName));
  }

  /** 범주만으로 상태를 바꾸는 단축 — 시스템 전이·테스트 호출부용({@link #updateStatus(Long, String, int, String, Long)}). */
  public IssueDetailResponse updateStatus(
      Long callerId, String projectKey, int number, String category) {
    return updateStatus(callerId, projectKey, number, category, null);
  }

  /**
   * 이슈 유형 변경 — 멤버 권한. 같은 프로젝트의 유형만 허용. 기존과 동일한 유형이면 history 미기록 fast-return. 변경 시 TYPE_CHANGED
   * history 한 건 기록.
   */
  public IssueDetailResponse setType(Long callerId, String projectKey, int number, Long newTypeId) {
    return setType(callerId, projectKey, number, newTypeId, null);
  }

  /**
   * 유형 변경과 부모 지정을 한 번에(WP-745). parentNumber 를 주면 새 유형 규칙으로 그 부모를 검증해 유형과 부모를 한 트랜잭션에서 바꾼다 — 일반 이슈는
   * 에픽만 부모로 둘 수 있어 「부모부터 지정하고 유형을 바꾸는」 순서가 불가능했고, 유형만 먼저 바꾸면 부모 없는 하위 태스크가 생겼다. parentNumber 없이
   * SUBTASK 로 바꾸려면 이미 하위 태스크의 부모가 될 수 있는 부모가 있어야 한다.
   */
  public IssueDetailResponse setType(
      Long callerId, String projectKey, int number, Long newTypeId, Integer parentNumber) {
    var project = accessGuard.assertMember(projectKey, callerId);
    // 행을 잠근 채 읽는다(setParent 와 같은 이유).
    var issue =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
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
      return parentNumber == null
          ? get(callerId, projectKey, number)
          : setParent(callerId, projectKey, number, parentNumber);
    }
    var oldType = typeRepository.findById(issue.typeId()).orElseThrow();
    boolean newIsSubtask = "SUBTASK".equals(newType.name());

    // 함께 온 부모는 새 유형 규칙으로 검증한다(EPIC 은 부모를 가질 수 없다). 그러면 기존 부모의 해제·유지 판정은 필요 없다.
    ResolvedParent newParent = null;
    if (parentNumber != null) {
      if ("EPIC".equals(newType.name())) {
        throw new EpicCannotHaveParentException();
      }
      newParent = resolveNewParent(project, issue, newIsSubtask, parentNumber);
    } else if (newIsSubtask && issue.parentIssueId() == null) {
      // 부모 없는 하위 태스크를 만들지 않는다 — 생성과 같은 규칙(WP-745).
      throw new SubtaskParentRequiredException();
    }

    // Phase 4a — SUBTASK → 비SUBTASK 전환, 또는 (SUBTASK 여부 무관) EPIC 으로 전환 시
    // 부모 자동 해제 + PARENT_CHANGED 기록 (parent 있을 때만). EPIC 은 부모를 가질 수 없으므로
    // 예: TASK(부모=EPIC#5) → EPIC 전환 시에도 반드시 해제해야 불변식이 깨지지 않는다.
    boolean releasesParent =
        newParent == null
            && issue.parentIssueId() != null
            && (("SUBTASK".equals(oldType.name()) && !"SUBTASK".equals(newType.name()))
                || "EPIC".equals(newType.name()));

    // 최종 리뷰 발견사항 1 — releasesParent 가 발동하지 않는데 부모가 유지되는 경우, 그 부모가 새 유형
    // 규칙에서도 여전히 유효한지 create()/setParent() 와 동일한 3-way 로직으로 검증한다(Case B).
    if (newParent == null && !releasesParent && issue.parentIssueId() != null) {
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
      issueRepository.updateParent(issue.id(), null);
      historyRecorder.recordParentChanged(callerId, issue.id(), currentParentRef(issue), null);
    } else if (newParent != null && !newParent.row().id().equals(issue.parentIssueId())) {
      issueRepository.updateParent(issue.id(), newParent.row().id());
      historyRecorder.recordParentChanged(
          callerId,
          issue.id(),
          currentParentRef(issue),
          toParentRef(newParent.row(), newParent.type()));
    }

    issueRepository.updateType(issue.id(), newType.id());
    // WP-1017 에픽이 됐는데 색이 없으면(처음 에픽이 됨) 자동 색을 붙인다. 예전에 에픽이었다가 돌아온 이슈는 남아 있던 색을 그대로 쓴다.
    if ("EPIC".equals(newType.name()) && issue.epicColor() == null) {
      assignEpicColor(issue, issue.id());
    }
    historyRecorder.recordTypeChanged(
        callerId,
        issue.id(),
        new IssueTypeSummary(oldType.id(), oldType.name(), oldType.colorToken(), oldType.icon()),
        new IssueTypeSummary(newType.id(), newType.name(), newType.colorToken(), newType.icon()));
    // 유형 변경은 정리성 쓰기 — AI 작업을 시작·터치하지 않는다(WP-425).
    changeNotifier.updatedWithoutTouch(project, number, issue.id(), callerId);
    return get(callerId, projectKey, number);
  }

  /**
   * 이슈 제목 정규화(WP-585) — 앞뒤 공백을 다듬고, 남는 것이 없으면(빈 문자열·공백뿐) 400. 생성은 @NotBlank 가 막지만 수정은 null=미변경이라
   * DTO 로 막을 수 없어, 생성·수정(웹·MCP·AI 도구 공통) 모두 이 경로로 저장한다.
   */
  static String normalizeTitle(String raw) {
    // 한 줄로 다듬는다 — 앞뒤 공백뿐 아니라 제로폭 문자만 남은 제목도 빈 제목으로 본다(WP-628)
    String title = raw == null ? "" : SingleLineTitles.normalize(raw);
    if (title.isEmpty()) {
      throw new IllegalArgumentException("이슈 제목을 입력해 주세요");
    }
    return title;
  }

  /**
   * 정리성 수정인지 — 제목·본문·상태를 하나도 바꾸지 않는 요청(우선순위·날짜·마일스톤·version 만)이다(WP-425). 이런 수정은 이슈를 정리할 뿐 그 일을 한
   * 것이 아니라 MCP 경유라도 AI 작업을 시작하지 않는다.
   */
  private static boolean isOrganizingOnly(UpdateIssueRequest req) {
    return req.title() == null
        && req.body() == null
        && req.status() == null
        && req.statusId() == null;
  }

  /**
   * 이슈 soft-delete. reporter 본인 또는 프로젝트 OWNER 만 가능.
   *
   * <p>OPEN 프로젝트는 비멤버 reporter 도 자기 이슈를 삭제할 수 있으므로, 기존 assertMember 선검증 대신 resolve 로 멤버십 없이 프로젝트
   * row 를 얻고, reporter/OWNER/ADMIN 여부로 직접 판정한다.
   */
  public void softDelete(Long callerId, String projectKey, int number) {
    var target = checkDeletable(callerId, projectKey, number);
    // 지울 행을 잠근다(WP-759) — 이 이슈 아래로 부모를 지정하거나 하위를 만드는 요청은 새 부모를 공유 잠금으로 읽으므로, 삭제가 커밋될 때까지
    // 기다렸다가 거절되고, 먼저 잠근 쪽이 있으면 삭제가 기다렸다가 새로 붙은 하위까지 함께 지운다.
    var row =
        issueRepository
            .findByProjectAndNumberForUpdate(target.project().id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    // Phase 4a — 부모 자체와 활성 자식들에 동일 timestamp 로 cascade soft-delete.
    // 자식 id 는 softDeleteChildren 호출 전에 수집해야 한다 (삭제 후엔 DELETED_AT 필터로 목록이 비어버림).
    var childIds = issueRepository.findActiveChildIds(row.id());
    var now = Instant.now();
    issueRepository.softDelete(row.id(), now);
    issueRepository.softDeleteChildren(row.id(), now);
    // 이슈(부모+자식) 삭제 시 연결된 드라이브 ref 정리 (source_id 는 비-FK 이므로 명시적 purge 필요)
    driveLinkService.purgeSource("ISSUE", row.id());
    driveLinkService.purgeSources("ISSUE", childIds);
    // 본문 이미지 강등(WP-199) — 삭제 후엔 syncIssueImages 가 불리지 않아 만료 해제 상태로 남는다. 부모+자식 모두 대상.
    var deletedIds = new java.util.ArrayList<Long>(childIds);
    deletedIds.add(row.id());
    bodyImageService.demoteAllOfIssues(deletedIds);
    // 삭제된 이슈(부모+자식)의 진행 중 AI 작업 종료(WP-377) — 남겨 두면 AI 위임 작업 건수·담당 작업 흐름에 유령 작업으로 남는다.
    agentWorkService.cancelAllForIssues(deletedIds);
    // 실시간 무효화 — checkDeletable 이 이미 resolve 한 project 를 재사용(중복 조회 방지)
    changeNotifier.deleted(target.project(), number, row.id(), callerId);
  }

  /** 이슈 삭제 사전검증(#856) — 확인 카드 dry-run 이 {@link #softDelete} 와 같은 {@link #checkDeletable} 을 쓴다. */
  @Transactional(readOnly = true)
  public void validateDeletable(Long callerId, String projectKey, int number) {
    checkDeletable(callerId, projectKey, number);
  }

  /** 이슈 삭제 술어 — reporter·프로젝트 OWNER·ADMIN(개인 프로젝트 제외)만. 삭제 대상 프로젝트·행을 돌려준다. */
  private DeletableIssue checkDeletable(Long callerId, String projectKey, int number) {
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
      throw new ProjectAccessDeniedException("이슈는 작성자나 프로젝트 소유자만 삭제할 수 있습니다");
    }
    // 비멤버 제보자(공개 접수함 등)는 처리팀이 손대기 전까지만 지울 수 있다(WP-634) — 담당·답변·진행이 생긴 뒤
    // 제보자가 지우면 처리팀의 기록이 함께 사라지기 때문이다. 그 뒤 삭제는 OWNER 에게 요청한다.
    if (!isOwner
        && !isAdmin
        && !accessGuard.isMemberOrAdmin(project, callerId)
        && !untouchedByTeam(
            row,
            !assigneeRepository.findUserIdsByIssue(row.id()).isEmpty(),
            commentRepository.existsFromOthers(row.id(), row.reporterId()))) {
      throw new ProjectAccessDeniedException("처리팀이 이미 맡았거나 답한 제보는 지울 수 없습니다. 담당 팀에 삭제를 요청해 주세요");
    }
    return new DeletableIssue(project, row);
  }

  /** 처리팀이 아직 손대지 않은 이슈인지(WP-634) — 「할 일」 상태이고 담당자도, 제보자 외 사람의 코멘트도 없다. */
  private static boolean untouchedByTeam(
      IssueRow row, boolean hasAssignee, boolean othersCommented) {
    return IssueStatuses.TODO.equals(row.status()) && !hasAssignee && !othersCommented;
  }

  /** checkDeletable 결과 — 삭제 대상 이슈 행과 이미 resolve 된 프로젝트(알림 발행에 재사용). */
  private record DeletableIssue(ProjectRow project, IssueRow row) {}

  /**
   * 이슈의 부모 설정/해제. newParentNumber == null 이면 해제. EPIC 자신은 부모를 가질 수 없다({@link
   * EpicCannotHaveParentException}). SUBTASK 는 비-EPIC 비-SUBTASK 부모만, 일반 이슈는 EPIC 부모만 허용한다. diff 0
   * 이면 history 미기록 fast-return.
   */
  public IssueDetailResponse setParent(
      Long callerId, String projectKey, int number, Integer newParentNumber) {
    var project = accessGuard.assertMember(projectKey, callerId);
    // 행을 잠근 채 읽는다 — 동시 부모·유형 변경이 옛 부모로 검증·이력(from)을 남기지 않게 한다.
    var row =
        issueRepository
            .findByProjectAndNumberForUpdate(project.id(), number)
            .orElseThrow(() -> new IssueNotFoundException(projectKey, number));
    var currentType = typeRepository.findById(row.typeId()).orElseThrow();
    boolean isSubtask = "SUBTASK".equals(currentType.name());
    boolean isEpic = "EPIC".equals(currentType.name());
    if (isEpic) {
      throw new EpicCannotHaveParentException();
    }

    // 하위 태스크의 부모는 뗄 수 없다 — 다른 부모로 바꾸는 것만 된다(WP-745).
    if (isSubtask && newParentNumber == null) {
      throw new SubtaskParentRequiredException();
    }
    Long newParentId = null;
    ParentRef newRef = null;
    if (newParentNumber != null) {
      var resolved = resolveNewParent(project, row, isSubtask, newParentNumber);
      newParentId = resolved.row().id();
      newRef = toParentRef(resolved.row(), resolved.type());
    }

    Long currentParentId = row.parentIssueId();
    if (java.util.Objects.equals(currentParentId, newParentId)) {
      return get(callerId, projectKey, number);
    }

    ParentRef oldRef = null;
    if (currentParentId != null) {
      var oldParent = issueRepository.findById(currentParentId).orElseThrow();
      var oldParentType = typeRepository.findById(oldParent.typeId()).orElseThrow();
      oldRef = toParentRef(oldParent, oldParentType);
    }

    issueRepository.updateParent(row.id(), newParentId);
    historyRecorder.recordParentChanged(callerId, row.id(), oldRef, newRef);
    // 부모 변경은 정리성 쓰기 — AI 작업을 시작·터치하지 않는다(WP-425).
    changeNotifier.updatedWithoutTouch(project, number, row.id(), callerId);
    return get(callerId, projectKey, number);
  }

  /**
   * WP-689 완료(DONE) 에픽에는 미완료 하위를 넣지 않는다 — 생성·부모 변경 모두. 넣으면 완료 에픽 아래 미완료 하위가 남아 #710 의 「미완료 하위가 있으면
   * 완료 불가」와 어긋난다. 취소(CANCELED) 에픽과 이미 끝난 하위는 막지 않는다.
   */
  private static void requireOpenChildAllowed(
      IssueRow parent, boolean parentIsEpic, String childStatus) {
    if (parentIsEpic
        && IssueStatuses.DONE.equals(parent.status())
        && !IssueStatuses.CLOSED.contains(childStatus)) {
      throw new InvalidParentException("완료된 에픽에는 미완료 하위 이슈를 넣을 수 없습니다. 에픽을 먼저 다시 열어 주세요");
    }
  }

  /** 검증을 마친 새 부모 — 행과 유형. */
  private record ResolvedParent(IssueRow row, com.workplace.issue.dto.IssueTypeRow type) {}

  /**
   * newParentNumber 의 이슈를 row 의 부모로 둘 수 있는지 검증한다(setParent·setType 공통). SUBTASK 는 비-EPIC 비-SUBTASK
   * 부모만, 일반 이슈는 EPIC 부모만. 완료 에픽에는 미완료 하위를 넣지 않는다(WP-689).
   */
  private ResolvedParent resolveNewParent(
      ProjectRow project, IssueRow row, boolean isSubtask, int newParentNumber) {
    if (newParentNumber == row.number()) throw new InvalidParentException("자기 자신을 부모로 지정할 수 없습니다");
    // 새 부모는 공유 잠금으로 읽는다(WP-759) — 그 부모를 지우는 중이면 삭제 커밋을 기다렸다 「찾을 수 없습니다」. 이미 지금 부모면 잠그지 않는다:
    // 그 부모의 삭제는 이 행(이미 잠금)을 하위로 함께 지우려 기다리므로, 여기서 부모를 또 기다리면 서로 기다리게 된다.
    boolean alreadyParent =
        row.parentIssueId() != null
            && issueRepository
                .findById(row.parentIssueId())
                .map(p -> p.number() == newParentNumber)
                .orElse(false);
    var newParent =
        (alreadyParent
                ? issueRepository.findByProjectAndNumber(project.id(), newParentNumber)
                : issueRepository.findByProjectAndNumberForShare(project.id(), newParentNumber))
            .orElseThrow(() -> new InvalidParentException("부모로 지정한 이슈를 찾을 수 없습니다"));
    var newParentType =
        typeRepository
            .findById(newParent.typeId())
            .orElseThrow(() -> new InvalidParentException("부모로 지정한 이슈의 유형을 확인할 수 없습니다"));
    boolean newParentIsSubtask = "SUBTASK".equals(newParentType.name());
    boolean newParentIsEpic = "EPIC".equals(newParentType.name());
    if (isSubtask) {
      if (newParentIsSubtask) throw new ParentCannotBeSubtaskException();
      if (newParentIsEpic) throw new SubtaskParentCannotBeEpicException();
    } else if (!newParentIsEpic) {
      throw new ParentNotAllowedException();
    }
    requireOpenChildAllowed(newParent, newParentIsEpic, row.status());
    return new ResolvedParent(newParent, newParentType);
  }

  /** row 의 지금 부모 참조(이력의 from) — 부모가 없으면 null. */
  private ParentRef currentParentRef(IssueRow row) {
    if (row.parentIssueId() == null) return null;
    var parent = issueRepository.findById(row.parentIssueId()).orElseThrow();
    return toParentRef(parent, typeRepository.findById(parent.typeId()).orElseThrow());
  }

  /** 부모 이슈 행·유형 행 → 응답·이력용 부모 요약(번호·제목·유형·상태, WP-247). 상위 변경 경로 세 곳이 같은 모양으로 만든다. */
  private static ParentRef toParentRef(IssueRow parent, com.workplace.issue.dto.IssueTypeRow type) {
    return new ParentRef(
        parent.number(),
        parent.title(),
        // 에픽 부모는 에픽 색(WP-1017) — 응답 경로(IssueRepository.findParentRefsByIssueIds)와 같은 규칙.
        new IssueTypeSummary(
            type.id(),
            type.name(),
            IssueRepository.parentTypeColor(type.name(), type.colorToken(), parent.epicColor()),
            type.icon()),
        parent.status(),
        // 부모의 사용자 정의 상태(WP-869) — findById 가 ISSUE_WITH_STATUS 조인으로 채운 값
        parent.statusId(),
        parent.statusName(),
        parent.statusColor());
  }
}
