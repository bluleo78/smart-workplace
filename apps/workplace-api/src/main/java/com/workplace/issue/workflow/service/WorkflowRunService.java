package com.workplace.issue.workflow.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.workflow.domain.AssigneeResolution;
import com.workplace.issue.workflow.domain.AssigneeResolution.Resolution;
import com.workplace.issue.workflow.domain.MoveActor;
import com.workplace.issue.workflow.domain.MoveRules;
import com.workplace.issue.workflow.domain.MoveRules.MovePlan;
import com.workplace.issue.workflow.domain.MoveViolation;
import com.workplace.issue.workflow.domain.OutputRules;
import com.workplace.issue.workflow.domain.RunRoleMembers;
import com.workplace.issue.workflow.domain.RunState;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.domain.WorkflowModel.Outcome;
import com.workplace.issue.workflow.domain.WorkflowRouting;
import com.workplace.issue.workflow.domain.WorkflowRouting.Route;
import com.workplace.issue.workflow.domain.WorkflowRouting.StartMatch;
import com.workplace.issue.workflow.dto.IssueWorkflowView;
import com.workplace.issue.workflow.dto.MoveRequest;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.IdempotentRow;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.RunRow;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRow;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.issue.workflow.repository.WorkflowVersionRef;
import com.workplace.issue.workflow.service.WorkflowRunViews.Snapshot;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * 워크플로우 실행의 시작·이동·조회(WP-1985). 판정은 순수 함수({@link WorkflowRouting}·{@link AssigneeResolution}·{@link
 * MoveRules})가 하고, 이 서비스는 읽기·잠금·순서·쓰기를 맡는다(원장 R1 — 규칙을 다시 쓰지 않는다).
 *
 * <p>순서(설계 §6·§7): 이슈 읽기(404) → 쓰기 권한(403) → 이슈 행 잠금 → 판정 → 쓰기. 잠금 순서는 이슈 → 구성원 → 실행 → 나머지다: 담당 변경
 * → 의견 댓글(둘 다 구성원 행을 잠근다)을 실행 행 revision 갱신·node_run·이벤트보다 먼저 쓴다. 댓글을 담당 변경 뒤에 쓰는 것은 댓글 알림이 댓글 쓸 때의
 * 담당에게 가기 때문이다(빠지는 옛 담당이 아니라 새 담당이 받게). 설계 §9 의 「실행·node_run → 댓글 → 담당」과 순서가 다르지만 한 트랜잭션이라 저장 결과는
 * 같고, 이슈 행 잠금 덕에 그 사이 revision 이 바뀌지 않는다(revision 비교 갱신은 그래도 지킨다).
 *
 * <p>내부 AI 실행·agent_work 는 만들지 않는다(WP-1986) — 담당·댓글은 Task 3 의 좁은 경로만 쓴다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class WorkflowRunService {

  private static final String OWNER = "OWNER";
  private static final String ADMIN = "ADMIN";

  /** 질문·답 기록(context 예약 키)과 남기는 최대 개수. */
  static final String QA_KEY = "_qa";

  static final int QA_MAX = 50;

  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final PermissionChecker permissionChecker;
  private final WorkflowRepository workflowRepository;
  private final WorkflowRunRepository runRepository;
  private final WorkflowMemberLookup memberLookup;
  private final WorkflowModelCache modelCache;
  private final WorkflowRunWriter writer;
  private final WorkflowRunViews views;
  private final ObjectMapper objectMapper;

  // ───────────────────────── 조회 ─────────────────────────

  /** 이슈의 실행 view — 활성, 없으면 가장 최근 실행, 하나도 없으면 빈 view(설계 §11). 못 보는 이슈는 404. */
  @Transactional(readOnly = true)
  public IssueWorkflowView view(long issueId, long actorId) {
    IssueRow issue = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    ProjectRow project = readableProject(issue, actorId);
    Optional<RunRow> run = currentRun(issue.id());
    if (run.isEmpty()) {
      return IssueWorkflowView.none();
    }
    return views.build(snapshot(project, issue, run.get()));
  }

  // ───────────────────────── 시작 ─────────────────────────

  /** 게시된 활성 버전으로 실행을 시작한다(설계 §6). dryRun 이면 같은 검사·판정으로 view 만 돌려주고 행·이벤트·담당은 바꾸지 않는다(잠그지도 않는다). */
  public IssueWorkflowView start(long issueId, long workflowId, boolean dryRun, long actorId) {
    IssueRow seen = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    ProjectRow project = writableProject(seen, actorId);
    IssueRow issue =
        dryRun
            ? seen
            : issueRepository
                .findActiveByIdForNoKeyUpdate(seen.id())
                .orElseThrow(IssueNotFoundException::new);
    if (IssueStatuses.isClosed(issue.status())) {
      throw WorkflowException.issueClosed();
    }
    WorkflowRow workflow =
        workflowRepository
            .findById(workflowId)
            .filter(w -> w.projectId() == project.id())
            .orElseThrow(WorkflowException::notFound);
    if (!workflow.enabled()) {
      throw WorkflowException.disabled();
    }
    if (workflow.activeVersionId() == null) {
      throw WorkflowException.notPublishedForStart();
    }
    if (runRepository.findActiveByIssue(issue.id()).isPresent()) {
      throw WorkflowException.alreadyActive();
    }
    long versionId = workflow.activeVersionId();
    WorkflowVersionRef version =
        workflowRepository.findVersionRefById(versionId).orElseThrow(WorkflowException::notFound);
    // 워크플로우 행이 RLS 로 보였으므로 그 활성 버전도 이 테넌트의 것이다 — 그 뒤에만 캐시를 쓴다.
    WorkflowModel model = model(versionId);
    RunRoleMembers members = RunRoleMembers.of(model, memberLookup.activeMembersOf(project.id()));
    List<Long> issueAssignees = issueAssignees(issue.id());

    StartMatch match =
        WorkflowRouting.start(model, issueAssignees, members)
            .orElseThrow(WorkflowException::noStartMatch);
    Route route = WorkflowRouting.route(model, match.to(), match.matched(), Map.of(), members);
    Resolution resolution =
        AssigneeResolution.forStart(model, match, route, issueAssignees, members);
    if (resolution.violation() != null) {
      throw WorkflowException.fromViolation(resolution.violation());
    }

    List<Long> next = resolution.assignees();
    // 이미 이슈 담당이던 사람은 사람이 넣은 것이라 워크플로우 것으로 적지 않는다(설계 §6).
    List<Long> added = minus(next, issueAssignees);
    String status = statusOf(model, route);
    String startKey = startNodeKey(model);
    Instant now = now();

    if (dryRun) {
      return views.build(
          dryRunSnapshot(
              version, model, members, issue, route, startKey, match, next, added, status, now));
    }

    writer.applyAssignees(actorId, project, issue, Set.copyOf(added), Set.of());
    RunRow run =
        runRepository
            .insertRun(issue.id(), versionId, status, route.stopNode(), "{}", actorId, now)
            .orElseThrow(WorkflowException::alreadyActive);
    if (RunState.COMPLETED.equals(status)) {
      // 시작하자마자 end 에 닿았다 — 끝난 시각을 남긴다. insertRun 은 ended_at 을 받지 않아(Task 1 저장소) 비교 갱신을 한 번 더
      // 쓰므로 revision 이 1 이 된다. 끝난 실행이라 이 revision 으로 이동할 일이 없고, 드문 경로에 저장소 계약을 넓히지 않으려고
      // 이대로 둔다(설계 §16 빌더 결정). 같은 트랜잭션에서 이슈 행을 잠근 채 방금 넣은 행이라 갱신은 늘 1 행이다.
      runRepository.compareAndAdvance(run.id(), 0, status, route.stopNode(), "{}", now);
    }
    writer.event(
        run.id(),
        WorkflowRunWriter.RUN_STARTED,
        WorkflowRunWriter.map(
            "workflowId", version.workflowId(),
            "versionNo", version.versionNo(),
            "startIndex", match.index(),
            "to", match.to(),
            "matched", match.matched(),
            "added", added),
        actorId,
        now);
    writer.enter(
        new WorkflowRunWriter.Entry(
            run.id(),
            issue.id(),
            model,
            List.of(),
            startKey,
            null,
            route,
            next,
            added,
            match.matched(),
            List.of(),
            actorId,
            now));
    // 버전 ref·모델·구성원은 위에서 읽은 것을 그대로 쓴다(쓰기로 바뀌지 않는다).
    return views.build(
        snapshot(
            issue,
            runRepository.findRun(run.id()).orElseThrow(),
            version.workflowId(),
            version.versionNo(),
            model,
            members));
  }

  // ───────────────────────── 이동 ─────────────────────────

  /**
   * 409 STALE — 실행을 다시 읽어 지금 노드·revision 을 싣는다(코드 리뷰 R29).
   *
   * <p>왜: 비교 갱신이 0 행이면 손에 든 run 은 이미 옛 값이다. 옛 값을 주면 요청자가 그 revision 으로 다시 보내 또 STALE 을 받는다. 다시 읽지
   * 못하면(그사이 지워짐 등) 손에 든 값으로 응답한다.
   */
  private WorkflowException staleNow(RunRow run) {
    RunRow now = runRepository.findRun(run.id()).orElse(run);
    return WorkflowException.fromViolation(MoveViolation.stale(now.currentNode(), now.revision()));
  }

  /**
   * 노드 이동(설계 §7). 같은 이슈(그 이슈의 어느 실행이든)·key·요청자의 재시도는 저장한 첫 응답을 그대로, 다른 요청자의 같은 key 는 409 STALE. 성공
   * 응답만 멱등 저장한다.
   */
  public IssueWorkflowView move(long issueId, MoveRequest req, long actorId) {
    // 1. 이슈 읽기(404)·쓰기(403) → 이슈 행 잠금
    IssueRow seen = issueRepository.findById(issueId).orElseThrow(IssueNotFoundException::new);
    ProjectRow project = writableProject(seen, actorId);
    IssueRow issue =
        issueRepository
            .findActiveByIdForNoKeyUpdate(seen.id())
            .orElseThrow(IssueNotFoundException::new);

    // 2. 실행 = 활성, 없으면 가장 최근
    RunRow run =
        currentRun(issue.id())
            .orElseThrow(() -> WorkflowException.fromViolation(MoveViolation.notActive()));

    // 3. 멱등 — 판정보다 먼저(끝난 뒤의 재시도도 첫 결과를 받게). 같은 이슈의 실행들에서 찾는다 — 끝낸 실행 A 의 응답을 잃은 사이
    // 실행 B 가 시작돼도 재시도가 B 의 새 이동이 되지 않게(리뷰 후속). 다른 요청자면 지금 실행(B) 기준의 STALE 이다.
    Optional<IdempotentRow> stored =
        runRepository.findIdempotentInIssue(issue.id(), req.idempotencyKey());
    if (stored.isPresent()) {
      // 요청자를 모르면(탈퇴 등) 다른 요청자로 본다.
      if (!Objects.equals(stored.get().actorId(), actorId)) {
        throw staleNow(run);
      }
      return objectMapper.readValue(stored.get().responseJson(), IssueWorkflowView.class);
    }

    // 4~8. 판정
    Snapshot before = snapshot(project, issue, run);
    RunState state = WorkflowRunViews.stateOf(before);
    WorkflowModel model = before.model();
    MoveActor actor = new MoveActor(actorId, isManager(project, actorId));
    Node from = state.currentNode() == null ? null : model.nodes().get(state.currentNode());
    Outcome outcome = from == null ? null : from.outcomes().get(req.outcome());
    List<MoveViolation> violations =
        MoveRules.check(from, outcome, req, state, actor, before.members());
    if (!violations.isEmpty()) {
      throw WorkflowException.fromViolation(violations.getFirst());
    }
    MovePlan plan = MoveRules.plan(from, outcome, req, state, before.members());
    Route route = plan.route();
    NodeRunRow leaving = WorkflowRunViews.currentVisit(before);

    // 담당(설계 §9) — C=지금 이슈 담당, W=떠나는 노드의 workflow_assigned_ids, N=다음 담당.
    Set<Long> c = new LinkedHashSet<>(before.issueAssignees());
    Set<Long> w = new LinkedHashSet<>(leaving.workflowAssignedIds());
    Set<Long> add = new LinkedHashSet<>();
    Set<Long> remove = new LinkedHashSet<>();
    Set<Long> nextW = new LinkedHashSet<>();
    List<Long> next = plan.resolution().assignees();
    if (!route.limitExceeded()) {
      Set<Long> n = new LinkedHashSet<>(next);
      Set<Long> wc = new LinkedHashSet<>(w);
      wc.retainAll(c);
      remove.addAll(wc);
      remove.removeAll(n); // 뺌 = (W ∩ C) − N
      add.addAll(n);
      add.removeAll(c); // 넣음 = N − C
      nextW.addAll(add);
      Set<Long> kept = new LinkedHashSet<>(wc);
      kept.retainAll(n);
      nextW.addAll(kept); // 다음 W = 넣음 ∪ (W ∩ C ∩ N)
    }
    // 넣음 ⊆ ¬C, 뺌 ⊆ C 라 둘은 겹치지 않는다(applyWorkflowChange 의 겹침 예외가 나지 않는다).

    Instant now = now();
    // 담당 교체 → 의견 댓글 순서: 댓글 알림(COMMENTED)의 받는 담당은 댓글을 쓸 때의 이슈 담당이라, 교체 뒤에 써야 빠지는 옛 담당이 아니라
    // 새 담당이 받는다(리뷰 후속). 둘 다 실행 행 갱신 전이라 잠금 순서(이슈 → 구성원 → 실행)는 그대로다.
    writer.applyAssignees(actorId, project, issue, add, remove);
    WorkflowRunWriter.WrittenComment comment = writer.comment(actorId, issue.id(), req.comment());
    Long commentId = comment == null ? null : comment.id();

    String status = statusOf(model, route);
    // _qa 에는 저장된(첨부 자리 표시를 바꾼) 댓글 본문을 넣는다 — 요청 원문의 file:N 은 저장 뒤 쓸모가 없다(리뷰 후속).
    Map<String, Object> context =
        withQa(
            plan.context(), model, from, outcome, comment == null ? null : comment.body(), actorId);
    if (!runRepository.compareAndAdvance(
        run.id(),
        run.revision(),
        status,
        route.stopNode(),
        writer.json(context),
        RunState.COMPLETED.equals(status) ? now : null)) {
      throw staleNow(run);
    }
    runRepository.completeNodeRun(
        leaving.id(),
        WorkflowRunWriter.NODE_COMPLETED,
        outcome.key(),
        outputsJson(req.outputs()),
        commentId,
        null,
        actorId,
        now);
    writer.event(
        run.id(),
        WorkflowRunWriter.MOVED,
        WorkflowRunWriter.map(
            "from", from.key(),
            "to", outcome.to(),
            "outcome", outcome.key(),
            "override", actor.isOverride(state),
            "added", List.copyOf(add),
            "removed", List.copyOf(remove)),
        actorId,
        now);
    writer.enter(
        new WorkflowRunWriter.Entry(
            run.id(),
            issue.id(),
            model,
            before.nodeRuns(),
            null,
            from.returnTo(),
            route,
            next,
            List.copyOf(nextW),
            leaving.assigneeIds(),
            leaving.workflowAssignedIds(),
            actorId,
            now));

    IssueWorkflowView view =
        views.build(snapshot(issue, runRepository.findRun(run.id()).orElseThrow(), before));
    runRepository.insertIdempotent(run.id(), req.idempotencyKey(), actorId, writer.json(view));
    return view;
  }

  // ───────────────────────── 권한 ─────────────────────────

  /** 읽을 수 있는 이슈의 프로젝트 — 못 보면 없는 이슈와 같은 404. */
  private ProjectRow readableProject(IssueRow issue, long actorId) {
    return projectRepository
        .findById(issue.projectId())
        .filter(p -> accessGuard.canRead(p, actorId))
        .orElseThrow(IssueNotFoundException::new);
  }

  /**
   * 쓸 수 있는 이슈의 프로젝트 — 프로젝트 구성원(비PERSONAL ADMIN 우회). 볼 수 없으면 404, 볼 수만 있으면(OPEN 비구성원) 403. 이동은
   * 담당·관리자 판정을 더 한다.
   */
  private ProjectRow writableProject(IssueRow issue, long actorId) {
    ProjectRow project =
        projectRepository.findById(issue.projectId()).orElseThrow(IssueNotFoundException::new);
    // 못 보는 프로젝트는 없는 이슈와 같은 본문의 404 — assertMember 의 숨김 문구로 이슈 존재가 드러나지 않게 먼저 거른다.
    if (!accessGuard.canRead(project, actorId)) {
      throw new IssueNotFoundException();
    }
    return accessGuard.assertMember(project.key(), actorId);
  }

  /** 프로젝트 관리자 — project:manage + OWNER(비PERSONAL ADMIN 우회), 정의 편집과 같은 기준(설계 §5). */
  private boolean isManager(ProjectRow project, long actorId) {
    String role = accessGuard.viewerRole(project, actorId);
    return (OWNER.equals(role) || ADMIN.equals(role))
        && permissionChecker.hasPermission(actorId, "project:manage");
  }

  // ───────────────────────── 읽기 ─────────────────────────

  /** 활성 실행, 없으면 가장 최근 실행. */
  private Optional<RunRow> currentRun(long issueId) {
    return runRepository.findCurrentByIssue(issueId);
  }

  /** DB 에서 읽은 실행의 모습. 실행 행이 RLS 로 보였으므로 그 버전도 이 테넌트의 것이다 — 그 뒤에만 캐시를 쓴다. */
  private Snapshot snapshot(ProjectRow project, IssueRow issue, RunRow run) {
    WorkflowVersionRef version =
        workflowRepository
            .findVersionRefById(run.versionId())
            .orElseThrow(WorkflowException::notFound);
    WorkflowModel model = model(run.versionId());
    RunRoleMembers members = RunRoleMembers.of(model, memberLookup.activeMembersOf(project.id()));
    return snapshot(issue, run, version.workflowId(), version.versionNo(), model, members);
  }

  /**
   * 쓰기 뒤 응답용 실행 모습 — 쓰기 전에 읽은 버전 ref·모델·활성 구성원을 그대로 쓰고, 쓰기로 바뀌는 것(실행 행·node_run·이슈 담당·context)만 다시
   * 읽는다. 버전은 실행에 고정이고 모델은 바꾸지 않으며, 같은 트랜잭션의 쓰기는 구성원을 바꾸지 않으므로 다시 읽은 것과 같은 view 가 나온다(멱등 저장 본문이 이것이라
   * 바이트 단위로 같아야 한다).
   */
  private Snapshot snapshot(IssueRow issue, RunRow run, Snapshot before) {
    return snapshot(
        issue, run, before.workflowId(), before.versionNo(), before.model(), before.members());
  }

  /** 실행 행·node_run·이슈 담당·context 를 읽어 주어진 버전·모델·구성원과 함께 실행 모습을 만든다. */
  private Snapshot snapshot(
      IssueRow issue,
      RunRow run,
      long workflowId,
      int versionNo,
      WorkflowModel model,
      RunRoleMembers members) {
    return new Snapshot(
        run.id(),
        run.status(),
        run.revision(),
        workflowId,
        versionNo,
        model,
        members,
        run.currentNode(),
        runRepository.findNodeRuns(run.id()),
        issueAssignees(issue.id()),
        IssueStatuses.isClosed(issue.status()),
        readContext(run.contextJson()));
  }

  /** 저장하지 않은 시작 계획의 모습(dryRun) — 실제 시작과 같은 방문을 만든 것처럼 꾸민다(id 0). */
  private Snapshot dryRunSnapshot(
      WorkflowVersionRef version,
      WorkflowModel model,
      RunRoleMembers members,
      IssueRow issue,
      Route route,
      String startKey,
      StartMatch match,
      List<Long> next,
      List<Long> added,
      String status,
      Instant now) {
    List<NodeRunRow> visits = new ArrayList<>();
    if (startKey != null) {
      visits.add(planned(startKey, WorkflowRunWriter.NODE_COMPLETED, List.of(), List.of(), now));
    }
    route
        .passed()
        .forEach(s -> visits.add(planned(s.nodeKey(), "COMPLETED", List.of(), List.of(), now)));
    String stopStatus;
    List<Long> stopAssignees = next;
    List<Long> stopW = added;
    if (route.limitExceeded()) {
      stopStatus = RunState.NODE_FAILED;
      stopAssignees = match.matched();
      stopW = List.of();
    } else if (RunState.COMPLETED.equals(status)) {
      stopStatus = WorkflowRunWriter.NODE_COMPLETED;
    } else {
      stopStatus = RunState.NODE_ACTIVE;
    }
    visits.add(planned(route.stopNode(), stopStatus, stopAssignees, stopW, now));
    List<Long> assigneesAfter = new ArrayList<>(issueAssignees(issue.id()));
    added.forEach(assigneesAfter::add);
    return new Snapshot(
        null,
        status,
        0,
        version.workflowId(),
        version.versionNo(),
        model,
        members,
        route.stopNode(),
        visits,
        assigneesAfter,
        false,
        Map.of());
  }

  /** dryRun 의 꾸민 방문 한 줄. */
  private static NodeRunRow planned(
      String key, String status, List<Long> assignees, List<Long> workflowAssigned, Instant now) {
    boolean left = !RunState.NODE_ACTIVE.equals(status);
    return new NodeRunRow(
        0L,
        0L,
        key,
        1,
        status,
        assignees,
        workflowAssigned,
        null,
        null,
        null,
        null,
        null,
        now,
        left ? now : null,
        null,
        false);
  }

  /** 버전 모델 사본(캐시). 부르는 쪽이 RLS 로 버전이 보이는 것을 확인한 뒤에만 부른다. */
  private WorkflowModel model(long versionId) {
    return modelCache.get(
        versionId,
        () ->
            workflowRepository
                .findVersionById(versionId)
                .orElseThrow(WorkflowException::notFound)
                .modelJson());
  }

  /** 지금 이슈 담당 — 저장소가 순서를 정하지 않아 id 오름차순으로 고정한다(시작 매치·응답이 실행마다 같게). */
  private List<Long> issueAssignees(long issueId) {
    return assigneeRepository.findUserIdsByIssue(issueId).stream().sorted().toList();
  }

  /** 저장된 context JSON 을 맵으로. */
  private Map<String, Object> readContext(String json) {
    if (json == null || json.isBlank()) {
      return Map.of();
    }
    return objectMapper.readValue(json, new TypeReference<LinkedHashMap<String, Object>>() {});
  }

  // ───────────────────────── 계산 ─────────────────────────

  /**
   * 머무는 곳에 따른 실행 상태 — 한도 초과 SUSPENDED, end COMPLETED, agent_task RUNNING, human_task WAITING(설계
   * §8).
   */
  private static String statusOf(WorkflowModel model, Route route) {
    if (route.limitExceeded()) {
      return RunState.SUSPENDED;
    }
    Node stop = model.nodes().get(route.stopNode());
    if (stop == null || "end".equals(stop.type())) {
      return RunState.COMPLETED;
    }
    return "human_task".equals(stop.type()) ? RunState.WAITING : RunState.RUNNING;
  }

  /** start 노드 키(검증을 통과한 게시본에는 하나 있다). */
  private static String startNodeKey(WorkflowModel model) {
    for (Node n : model.nodes().values()) {
      if ("start".equals(n.type())) {
        return n.key();
      }
    }
    return null;
  }

  /**
   * 저장할 context — {@link MovePlan#context()}(이번 출력을 덮은 것)를 그대로 쓰고, 질문·답이면 예약 키 {@code _qa} 만 새 목록으로
   * 바꾼 사본을 만든다. 계획의 맵과 그 안의 노드·질문 맵은 바꾸지 않는다(얕은 불변 사본이라 안쪽은 공유된다).
   *
   * <ul>
   *   <li>질문(목적 노드의 returnTo 가 지금 노드): {@code {askNode, answerNode, question, askedBy}} 를 더한다
   *   <li>답(떠나는 노드의 returnTo 로 가는 결과): 그 답 노드의 마지막 미답 질문에 {@code answer, answeredBy} 를 채운 새 맵으로 바꾼다
   *   <li>최근 {@link #QA_MAX} 개만 남긴다. 값이 없는 칸은 넣지 않는다
   * </ul>
   *
   * @param commentBody 저장된 의견 댓글 본문(자리 표시를 바꾼 것). 댓글을 만들지 않았으면(없음·공백뿐) null 이라 question·answer 칸을
   *     넣지 않는다
   */
  private static Map<String, Object> withQa(
      Map<String, Object> planned,
      WorkflowModel model,
      Node from,
      Outcome outcome,
      String commentBody,
      long actorId) {
    boolean question = OutputRules.isQuestion(model, from, outcome);
    boolean answer = from.returnTo() != null && from.returnTo().equals(outcome.to());
    if (!question && !answer) {
      return planned;
    }
    List<Object> qa = new ArrayList<>();
    if (planned.get(QA_KEY) instanceof List<?> previous) {
      qa.addAll(previous);
    }
    if (question) {
      Map<String, Object> entry = new LinkedHashMap<>();
      entry.put("askNode", from.key());
      entry.put("answerNode", outcome.to());
      if (commentBody != null) {
        entry.put("question", commentBody);
      }
      entry.put("askedBy", actorId);
      qa.add(entry);
    } else {
      for (int i = qa.size() - 1; i >= 0; i--) {
        if (qa.get(i) instanceof Map<?, ?> m
            && from.key().equals(m.get("answerNode"))
            && !m.containsKey("answer")) {
          Map<String, Object> filled = new LinkedHashMap<>();
          m.forEach((k, v) -> filled.put(String.valueOf(k), v));
          if (commentBody != null) {
            filled.put("answer", commentBody);
          }
          filled.put("answeredBy", actorId);
          qa.set(i, filled);
          break;
        }
      }
    }
    while (qa.size() > QA_MAX) {
      qa.removeFirst();
    }
    Map<String, Object> copy = new LinkedHashMap<>(planned);
    copy.put(QA_KEY, List.copyOf(qa));
    return copy;
  }

  /** 떠나는 방문에 남길 출력 JSON — 값이 있는 키만(context 와 같은 규칙), 하나도 없으면 null. */
  private String outputsJson(Map<String, Object> outputs) {
    if (outputs == null) {
      return null;
    }
    Map<String, Object> kept = new LinkedHashMap<>();
    outputs.forEach(
        (k, v) -> {
          if (k != null && v != null) {
            kept.put(k, v);
          }
        });
    return kept.isEmpty() ? null : writer.json(kept);
  }

  /** source 순서를 지키며 other 에 없는 것만. */
  private static List<Long> minus(List<Long> source, List<Long> other) {
    List<Long> out = new ArrayList<>();
    for (Long id : source) {
      if (!other.contains(id) && !out.contains(id)) {
        out.add(id);
      }
    }
    return List.copyOf(out);
  }

  /** 요청 하나의 시각 — DB 단위(마이크로초)로 잘라 응답과 저장 값이 같게. */
  private static Instant now() {
    return Instant.now().truncatedTo(ChronoUnit.MICROS);
  }
}
