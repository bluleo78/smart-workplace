package com.workplace.issue.workflow.service;

import com.workplace.global.security.PermissionChecker;
import com.workplace.global.util.PersonNames;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.IssueNotFoundException;
import com.workplace.issue.outbound.IssueChatPoster;
import com.workplace.issue.repository.IssueAssigneeRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueBodyImageService;
import com.workplace.issue.workflow.domain.AssigneeResolution;
import com.workplace.issue.workflow.domain.AssigneeResolution.Resolution;
import com.workplace.issue.workflow.domain.MoveActor;
import com.workplace.issue.workflow.domain.MoveRules;
import com.workplace.issue.workflow.domain.MoveRules.MovePlan;
import com.workplace.issue.workflow.domain.MoveViolation;
import com.workplace.issue.workflow.domain.NodeTypes;
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
import com.workplace.project.exception.ProjectAccessDeniedException;
import com.workplace.project.exception.ProjectNotFoundException;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
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
import tools.jackson.databind.JsonNode;
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
 * <p>agent_work·AI 깨우기는 이 서비스가 직접 쓰지 않는다 — 진입은 {@link WorkflowAgentWorkBridge} 가 진입 이벤트로, 떠남은 이동이
 * 다리의 {@code onNodeLeft} 를 불러 같은 트랜잭션에서 한다(WP-1986). 담당·댓글은 좁은 경로만 쓴다.
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

  /** 질문 대기 노드에서 질문한 AI 노드로 돌아가는 결과 키(WP-2093 챗 답 이동). */
  static final String ANSWERED = "answered";

  /** 챗 답 이동의 멱등 키 앞머리 — 글 id 를 붙여 같은 글이 두 번 옮기지 않게 한다. */
  static final String CHAT_ANSWER_KEY_PREFIX = "chat-answer-";

  private final IssueRepository issueRepository;
  private final IssueAssigneeRepository assigneeRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final PermissionChecker permissionChecker;
  private final WorkflowRepository workflowRepository;
  private final WorkflowRunRepository runRepository;
  private final WorkflowMemberLookup memberLookup;
  private final WorkflowModelLoader modelLoader;
  private final WorkflowRunWriter writer;
  private final WorkflowRunViews views;
  private final WorkflowAgentWorkBridge agentWorkBridge;
  private final IssueChatPoster chatPoster;
  // 질문 챗 글의 스테이징 파일 자리표시(WP-1634)를 챗 첨부·파일 이름으로 바꾼다(WP-2093).
  private final IssueBodyImageService bodyImageService;
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
    return start(issueId, workflowId, dryRun, actorId, Set.of());
  }

  /**
   * {@link #start(long, long, boolean, long)} 와 같되, 같은 트랜잭션에서 앞선 담당 교체가 이미 ASSIGNED 를 보낸 사람을 시작 노드
   * 진입의 「이미 알림 받은 사람」에 더한다(「지정하고 바로 시작」 — 원장 R3 진입당 ASSIGNED 하나). 담당 계산·워크플로우가 넣은 사람(added)에는 섞지
   * 않는다.
   *
   * @param alreadyNotified 앞선 담당 교체로 이미 ASSIGNED 를 받은 사람
   */
  IssueWorkflowView start(
      long issueId, long workflowId, boolean dryRun, long actorId, Set<Long> alreadyNotified) {
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
            now,
            union(added, alreadyNotified)));
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
  WorkflowException staleNow(RunRow run) {
    RunRow now = runRepository.findRun(run.id()).orElse(run);
    return WorkflowException.fromViolation(MoveViolation.stale(now.currentNode(), now.revision()));
  }

  /**
   * 노드 이동(설계 §7). 겨눈 실행(요청의 runId, 없으면 지금 실행)·key·요청자의 재시도는 저장한 첫 응답을 그대로, 다른 요청자의 같은 key 는 409
   * STALE. 옛 실행을 겨눈 새 key 는 받지 않는다(409 STALE). 성공 응답만 멱등 저장한다.
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

    // 3. 멱등 — 판정보다 먼저(끝난 뒤의 재시도도 첫 결과를 받게). 요청이 겨눈 실행 하나에서만 찾는다(리뷰 후속 R40).
    // 왜 이슈 전체가 아니라 겨눈 실행: AI 는 key 를 결정적으로 만들어 실행 A 에서 쓴 key 를 실행 B 에서 다시 쓴다. 이슈 전체에서 찾으면 같은
    // 요청자는 A 의 응답을 받고 B 는 움직이지 않으며, 다른 요청자는 맞는 revision 이어도 늘 STALE 이다.
    // runId 가 없거나 지금 실행이면 지금 실행을 겨눈 것이다(하위 호환). 옛 실행을 겨누면 그 실행의 첫 응답을 돌려주는 재시도만 받는다 — A 를 끝낸
    // 이동의 응답을 잃은 사이 B 가 시작돼도 재시도가 B 의 새 이동이 되지 않게. 다른 이슈의 runId·없는 runId 는 존재를 드러내지 않게 404 가 아니라
    // 같은 STALE 이다(실행의 issue_id 를 비교한다).
    boolean targetsCurrent = req.runId() == null || req.runId() == run.id();
    if (!targetsCurrent
        && runRepository.findRun(req.runId()).filter(r -> r.issueId() == issue.id()).isEmpty()) {
      // 이 이슈의 실행이 아니다 — 다른 이슈의 실행 멱등 응답을 읽거나 존재를 알아내지 못하게 STALE.
      throw staleNow(run);
    }
    long targetRunId = targetsCurrent ? run.id() : req.runId();
    Optional<IdempotentRow> stored =
        runRepository.findIdempotent(targetRunId, req.idempotencyKey());
    if (stored.isPresent()) {
      // 요청자를 모르면(탈퇴 등) 다른 요청자로 본다. STALE 은 지금 실행 기준의 노드·revision 을 싣는다.
      if (!Objects.equals(stored.get().actorId(), actorId)) {
        throw staleNow(run);
      }
      return objectMapper.readValue(stored.get().responseJson(), IssueWorkflowView.class);
    }
    if (!targetsCurrent) {
      // 옛 실행을 겨눈 새 이동 — 요청자가 본 실행이 이미 지나갔으니 지금 실행 기준으로 다시 보게 한다.
      throw staleNow(run);
    }
    return advance(
        project, issue, run, req, new MoveActor(actorId, isManager(project, actorId)), null);
  }

  /**
   * 이슈 챗 사람 글을 질문 대기 노드의 답으로 받아 {@code answered} 이동을 한다(WP-2093, 설계 §2). 질문 대기가 아니면 아무것도 쓰지 않고 빈
   * 값이다.
   *
   * <p>답으로 보는 때: 글쓴이가 프로젝트 구성원(쓰기 권한 — 아니면 「답 아님」)이고, 이슈의 활성 실행이 WAITING 이고, 지금 노드가 {@code
   * returnTo} 가 있는 human_task(질문 이동이 들어간 노드)이고 {@code answered} 결과가 있고, 글이 그 질문 글보다 뒤다(질문을 챗 글로 남기지
   * 않은 옛 댓글 질문이면 이 비교는 건너뛴다 — 배포 전부터 기다리던 실행도 챗 답으로 풀리게). 멈춤(SUSPENDED)·끝난 실행·일반 사람 노드 대기는 답이 아니다.
   *
   * <p>이동은 {@link #move} 와 같은 경로({@link #advance})로 돈다 — revision 은 잠근 실행의 지금 값, 멱등 키는 글 id 로 만든
   * {@code chat-answer-<messageId>}. 담당 검사만 챗 답 행위자로 통과시키고(override 로 적지 않는다), 의견 댓글은 만들지 않으며(답은 챗
   * 글 그 자체), {@code _qa} 에 {@code answerMessageId} 를 남긴다. 그 밖의 판정(결과·의견·담당 계산) 위반은 그대로 던진다 — 부르는 쪽이
   * 세이브포인트로 감싸 「답 아님」으로 바꾼다.
   *
   * @param body 챗 글 본문(멘션 토큰 포함 원문) — 이동 의견·{@code _qa.answer} 가 된다
   * @return 이동 뒤 실행 모습. 답이 아니면 빈 값
   */
  public Optional<IssueWorkflowView> answerFromChat(
      long issueId, long messageId, long actorId, String body) {
    IssueRow seen = issueRepository.findById(issueId).orElse(null);
    if (seen == null) {
      return Optional.empty();
    }
    ProjectRow project;
    try {
      project = writableProject(seen, actorId);
    } catch (IssueNotFoundException | ProjectNotFoundException | ProjectAccessDeniedException e) {
      // 구성원이 아니면 이동 권한이 없다 — 오류가 아니라 「답 아님」이다(글은 그대로 저장된다).
      return Optional.empty();
    }
    IssueRow issue = issueRepository.findActiveByIdForNoKeyUpdate(seen.id()).orElse(null);
    if (issue == null) {
      return Optional.empty();
    }
    // 이슈 행을 잠근 뒤 읽은 활성 실행 — 그 revision 으로 옮긴다(그사이 다른 이동이 끼지 못한다).
    RunRow run =
        runRepository
            .findActiveByIssue(issue.id())
            .filter(r -> RunState.WAITING.equals(r.status()))
            .orElse(null);
    if (run == null || run.currentNode() == null) {
      return Optional.empty();
    }
    WorkflowModel model = model(run.versionId());
    Node node = model.nodes().get(run.currentNode());
    if (node == null
        || !NodeTypes.HUMAN_TASK.equals(node.type())
        || node.returnTo() == null
        || !node.outcomes().containsKey(ANSWERED)) {
      return Optional.empty();
    }
    Long questionMessageId = pendingQuestionMessageId(readContext(run.contextJson()), node.key());
    if (questionMessageId != null && messageId <= questionMessageId) {
      return Optional.empty();
    }
    MoveRequest req =
        new MoveRequest(
            node.key(),
            ANSWERED,
            null,
            null,
            body,
            run.revision(),
            CHAT_ANSWER_KEY_PREFIX + messageId,
            run.id());
    return Optional.of(advance(project, issue, run, req, MoveActor.chatAnswer(actorId), messageId));
  }

  /**
   * 그 답 노드의 마지막 미답 질문이 챗 글로 남긴 질문 글 id — 없으면(옛 댓글 질문·질문 기록 없음) null. {@link #withQa} 가 답을 채울 항목과 같은
   * 항목을 본다.
   */
  private static Long pendingQuestionMessageId(Map<String, Object> context, String answerNode) {
    if (!(context.get(QA_KEY) instanceof List<?> qa)) {
      return null;
    }
    for (int i = qa.size() - 1; i >= 0; i--) {
      if (qa.get(i) instanceof Map<?, ?> m
          && answerNode.equals(m.get("answerNode"))
          && isUnanswered(m.get("answer"))) {
        return m.get("questionMessageId") instanceof Number n ? n.longValue() : null;
      }
    }
    return null;
  }

  /**
   * {@code _qa} 항목의 answer 값이 「아직 답 없음」인지 — 칸이 없거나(null) JSON null 이면 미답이다. 답 채우기({@link
   * #withQa})·챗 답의 질문 글 찾기·조회의 질문 대기 표시({@code WorkflowRunQueryService.pendingQuestion})가 같은 기준을 쓴다
   * — 한쪽만 answer:null 을 미답으로 보면 화면에는 질문이 보이는데 챗 답이 다른 항목을 채우는 어긋남이 생긴다(WP-2093 리뷰 후속).
   *
   * @param answer Map 으로 읽은 값(없으면 null) 또는 Jackson 트리 노드
   */
  static boolean isUnanswered(Object answer) {
    return answer == null || (answer instanceof JsonNode node && node.isNull());
  }

  /**
   * 이동 판정·쓰기 본체 — {@link #move}(화면·도구)와 {@link #answerFromChat}(챗 답)이 같이 쓴다. 이슈 행은 이미 잠갔고 run 은 겨눈
   * 지금 실행이다.
   *
   * @param answerMessageId 챗 답 이동이면 그 챗 글 id(의견 댓글을 쓰지 않고 {@code _qa.answerMessageId} 로 남긴다), 일반
   *     이동이면 null
   */
  private IssueWorkflowView advance(
      ProjectRow project,
      IssueRow issue,
      RunRow run,
      MoveRequest req,
      MoveActor actor,
      Long answerMessageId) {
    long actorId = actor.id();
    // 4~8. 판정
    Snapshot before = snapshot(project, issue, run);
    RunState state = WorkflowRunViews.stateOf(before);
    WorkflowModel model = before.model();
    Node from = state.currentNode() == null ? null : model.nodes().get(state.currentNode());
    Outcome outcome = from == null ? null : from.outcomes().get(req.outcome());
    List<MoveViolation> violations =
        MoveRules.check(from, outcome, req, state, actor, before.members());
    if (!violations.isEmpty()) {
      throw WorkflowException.fromViolation(violations.getFirst());
    }
    // 시안 첨부·답 선택지(WP-2147)는 질문 이동의 질문 글에만 붙는다 — 쓰기 전에 거른다(붙일 글이 없는데 조용히 버리지 않게).
    boolean askMove = OutputRules.isQuestion(model, from, outcome);
    boolean hasQuestionText = req.comment() != null && PersonNames.hasVisibleChar(req.comment());
    if (req.hasQuestionExtras() && !(askMove && hasQuestionText)) {
      throw WorkflowException.questionExtrasWithoutQuestion();
    }
    MovePlan plan = MoveRules.plan(from, outcome, req, state, before.members());
    Route route = plan.route();
    NodeRunRow leaving = WorkflowRunViews.currentVisit(before);

    // 담당(설계 §9) — 조치(onError·옮기기)와 같은 계산을 쓴다(원장 R1).
    List<Long> next = plan.resolution().assignees();
    AssigneeDiff diff =
        assigneeDiff(
            before.issueAssignees(), leaving.workflowAssignedIds(), next, route.limitExceeded());
    Set<Long> add = diff.add();
    Set<Long> remove = diff.remove();
    List<Long> nextW = diff.nextWorkflowAssigned();

    Instant now = now();
    // 담당 교체 → 의견 댓글 순서: 댓글 알림(COMMENTED)의 받는 담당은 댓글을 쓸 때의 이슈 담당이라, 교체 뒤에 써야 빠지는 옛 담당이 아니라
    // 새 담당이 받는다(리뷰 후속). 둘 다 실행 행 갱신 전이라 잠금 순서(이슈 → 구성원 → 실행)는 그대로다.
    writer.applyAssignees(actorId, project, issue, add, remove);
    // 질문 이동(WP-2093): AI 의 질문은 이슈 댓글이 아니라 이슈 챗의 「답변 필요 질문」으로 남긴다 — 사람이 챗에서 질문을 보고 거기서 답하게.
    // 이 경우 node_run.comment_id 는 null 이고 질문 글 id 는 _qa 에 questionMessageId 로 남는다.
    // 질문 알림(AI_QUESTION)도 챗 글 이벤트가 낸다. 의견이 비면(공백뿐) 올릴 글이 없어 아무것도 쓰지 않는다. 담당 교체 뒤에 쓰는 순서는 댓글과 같다(질문
    // 알림이 새 담당에게 가게).
    WorkflowRunWriter.WrittenComment comment = null;
    Long questionMessageId = null;
    String questionText = null;
    if (askMove) {
      // 챗과 같은 기준(그려지는 글자)으로 빈 의견을 본다 — 제로폭만 있는 의견을 올리면 챗이 빈 글로 거절해 이동 전체가 실패한다.
      if (hasQuestionText) {
        // 의견의 file:N 자리표시는 댓글처럼 본문 주소로 바꾸지 않고 챗 글 첨부로 붙이며, 그 자리는 파일 이름으로 바꾼다(깨진 링크가 남지 않게).
        // _qa.question 에도 바꾼 본문을 남긴다 — 원문의 file:N 은 저장 뒤 쓸모가 없다.
        IssueBodyImageService.ChatBody chatBody =
            bodyImageService.resolveStagedPlaceholdersForChat(
                actorId, req.comment(), IssueChatPoster.BODY_MAX);
        questionText = chatBody.body();
        // 요청의 fileIds(시안, WP-2147)를 자리표시 첨부 뒤에 붙인다 — 같은 파일을 두 번 클레임하지 않게 겹치는 id 는 한 번만. 선택지를 주면
        // 그대로 칩으로 저장하고, 안 주면(null) 서버가 커밋 뒤 질문 글에서 뽑는다(WP-1569).
        LinkedHashSet<Long> files = new LinkedHashSet<>(chatBody.fileIds());
        files.addAll(req.fileIds());
        questionMessageId =
            chatPoster.post(
                actorId,
                project.key(),
                issue.number(),
                chatBody.body(),
                true,
                List.copyOf(files),
                req.normalizedOptions());
      }
    } else if (answerMessageId == null) {
      comment = writer.comment(actorId, issue.id(), req.comment());
    }
    // 챗 답 이동(WP-2093)은 의견 댓글을 쓰지 않는다 — 답은 챗 글 그 자체라 _qa 에 그 본문과 글 id 를 남긴다.
    Long commentId = comment == null ? null : comment.id();

    String status = statusOf(model, route);
    // _qa 에 남길 본문 — 질문 이동이면 챗 질문 글 본문, 챗 답 이동이면 답 챗 글 본문, 그 밖에는 저장된(첨부 자리 표시를 바꾼) 댓글 본문(요청
    // 원문의 file:N 은 저장 뒤 쓸모가 없다, 리뷰 후속). 의견 글을 만들지 않았으면 null.
    String qaBody;
    if (askMove) {
      qaBody = questionText;
    } else if (answerMessageId != null) {
      qaBody = req.comment();
    } else {
      qaBody = comment == null ? null : comment.body();
    }
    Map<String, Object> context =
        withQa(
            plan.context(),
            model,
            from,
            outcome,
            qaBody,
            questionMessageId,
            answerMessageId,
            actorId);
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
    // AI 작업 떠남(WP-1986) — 다음 노드 진입(enter 가 낸 진입 이벤트로 다리가 SUBMITTED 를 연다)보다 먼저 한다. 같은 AI 가 다음 노드도
    // 맡으면 이 닫기(COMPLETED) 뒤에 진입이 새 SUBMITTED 를 열어야 진행 중 행 유일성과 충돌하지 않는다. 반복 회수를 작업 기록보다 먼저 —
    // AgentWorkService 의 잠금 순서(반복 → 작업 기록)와 맞춘다.
    agentWorkBridge.retireRemovedAgents(issue.id(), remove);
    if (NodeTypes.AGENT_TASK.equals(from.type())) {
      agentWorkBridge.onNodeLeft(
          issue.id(), leaving.assigneeIds(), OutputRules.isQuestion(model, from, outcome));
    }
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
            nextW,
            leaving.assigneeIds(),
            leaving.workflowAssignedIds(),
            actorId,
            now,
            Set.copyOf(add)));

    IssueWorkflowView view =
        views.build(snapshot(issue, runRepository.findRun(run.id()).orElseThrow(), before));
    runRepository.insertIdempotent(run.id(), req.idempotencyKey(), actorId, writer.json(view));
    return view;
  }

  // ───────────────────────── 권한 ─────────────────────────

  /** 읽을 수 있는 이슈의 프로젝트 — 못 보면 없는 이슈와 같은 404. */
  ProjectRow readableProject(IssueRow issue, long actorId) {
    return projectRepository
        .findById(issue.projectId())
        .filter(p -> accessGuard.canRead(p, actorId))
        .orElseThrow(IssueNotFoundException::new);
  }

  /**
   * 쓸 수 있는 이슈의 프로젝트 — 프로젝트 구성원(비PERSONAL ADMIN 우회). 볼 수 없으면 404, 볼 수만 있으면(OPEN 비구성원) 403. 이동은
   * 담당·관리자 판정을 더 한다.
   */
  ProjectRow writableProject(IssueRow issue, long actorId) {
    ProjectRow project =
        projectRepository.findById(issue.projectId()).orElseThrow(IssueNotFoundException::new);
    // 못 보는 프로젝트는 없는 이슈와 같은 본문의 404 — assertMember 의 숨김 문구로 이슈 존재가 드러나지 않게 먼저 거른다.
    if (!accessGuard.canRead(project, actorId)) {
      throw new IssueNotFoundException();
    }
    return accessGuard.assertMember(project.key(), actorId);
  }

  /** 프로젝트 관리자 — project:manage + OWNER(비PERSONAL ADMIN 우회), 정의 편집과 같은 기준(설계 §5). */
  boolean isManager(ProjectRow project, long actorId) {
    String role = accessGuard.viewerRole(project, actorId);
    return (OWNER.equals(role) || ADMIN.equals(role))
        && permissionChecker.hasPermission(actorId, "project:manage");
  }

  // ───────────────────────── 읽기 ─────────────────────────

  /** 활성 실행, 없으면 가장 최근 실행. */
  Optional<RunRow> currentRun(long issueId) {
    return runRepository.findCurrentByIssue(issueId);
  }

  /** DB 에서 읽은 실행의 모습. 실행 행이 RLS 로 보였으므로 그 버전도 이 테넌트의 것이다 — 그 뒤에만 캐시를 쓴다. */
  Snapshot snapshot(ProjectRow project, IssueRow issue, RunRow run) {
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
  Snapshot snapshot(IssueRow issue, RunRow run, Snapshot before) {
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
        readContext(run.contextJson()),
        run.endedAt());
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
        Map.of(),
        null);
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
    return modelLoader.get(versionId);
  }

  /** 진입의 「이미 알림 받은 사람」 — 시작이 넣은 사람과 앞선 담당 교체가 알린 사람을 합친다. */
  private static Set<Long> union(List<Long> added, Set<Long> alreadyNotified) {
    Set<Long> all = new LinkedHashSet<>(added);
    all.addAll(alreadyNotified);
    return all;
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
   * 노드를 떠나 다음 담당으로 바꿀 때의 이슈 담당 변화(설계 §9).
   *
   * @param add 넣을 사람 = N − C
   * @param remove 뺄 사람 = (W ∩ C) − N
   * @param nextWorkflowAssigned 머무는 노드의 workflow_assigned_ids = 넣음 ∪ (W ∩ C ∩ N)
   */
  record AssigneeDiff(Set<Long> add, Set<Long> remove, List<Long> nextWorkflowAssigned) {}

  /**
   * 담당 변화 계산 — 이동과 조치(onError·관리자 옮기기)가 같이 쓴다(원장 R1 — 규칙을 두 곳에 쓰지 않는다). 연쇄 한도를 넘었으면 담당을 바꾸지 않는다(설계
   * §8). 넣음 ⊆ ¬C, 뺌 ⊆ C 라 둘은 겹치지 않는다({@code applyWorkflowChange} 의 겹침 예외가 나지 않는다).
   *
   * @param current C — 지금 이슈 담당
   * @param leavingWorkflowAssigned W — 떠나는 노드의 workflow_assigned_ids
   * @param next N — 머무는 노드의 담당
   */
  static AssigneeDiff assigneeDiff(
      Collection<Long> current,
      Collection<Long> leavingWorkflowAssigned,
      List<Long> next,
      boolean limitExceeded) {
    Set<Long> add = new LinkedHashSet<>();
    Set<Long> remove = new LinkedHashSet<>();
    Set<Long> nextW = new LinkedHashSet<>();
    if (!limitExceeded) {
      Set<Long> c = new LinkedHashSet<>(current);
      Set<Long> n = new LinkedHashSet<>(next);
      Set<Long> wc = new LinkedHashSet<>(leavingWorkflowAssigned);
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
    return new AssigneeDiff(add, remove, List.copyOf(nextW));
  }

  /**
   * 머무는 곳에 따른 실행 상태 — 한도 초과 SUSPENDED, end COMPLETED, agent_task RUNNING, human_task WAITING(설계
   * §8).
   */
  static String statusOf(WorkflowModel model, Route route) {
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
   * @param commentBody 질문이면 요청 의견 원문(챗 질문 글 본문 그대로), 답이면 저장된 의견 댓글 본문(자리 표시를 바꾼 것). 만든 글이
   *     없으면(없음·공백뿐) null 이라 question·answer 칸을 넣지 않는다
   * @param questionMessageId 질문을 이슈 챗 글로 남겼으면 그 메시지 id(WP-2093), 아니면 null
   * @param answerMessageId 답을 이슈 챗 글로 받았으면 그 메시지 id(WP-2093 챗 답 이동), 아니면 null
   */
  private static Map<String, Object> withQa(
      Map<String, Object> planned,
      WorkflowModel model,
      Node from,
      Outcome outcome,
      String commentBody,
      Long questionMessageId,
      Long answerMessageId,
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
      if (questionMessageId != null) {
        entry.put("questionMessageId", questionMessageId);
      }
      entry.put("askedBy", actorId);
      qa.add(entry);
    } else {
      for (int i = qa.size() - 1; i >= 0; i--) {
        if (qa.get(i) instanceof Map<?, ?> m
            && from.key().equals(m.get("answerNode"))
            && isUnanswered(m.get("answer"))) {
          Map<String, Object> filled = new LinkedHashMap<>();
          m.forEach((k, v) -> filled.put(String.valueOf(k), v));
          if (commentBody != null) {
            filled.put("answer", commentBody);
          }
          filled.put("answeredBy", actorId);
          if (answerMessageId != null) {
            filled.put("answerMessageId", answerMessageId);
          }
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
  static Instant now() {
    return Instant.now().truncatedTo(ChronoUnit.MICROS);
  }
}
