package com.workplace.issue.workflow.service;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.IssueRow;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.workflow.domain.NodeTypes;
import com.workplace.issue.workflow.domain.WorkflowModel;
import com.workplace.issue.workflow.domain.WorkflowModel.Node;
import com.workplace.issue.workflow.dto.MyWorkflowTurn;
import com.workplace.issue.workflow.dto.WorkflowRunCounts;
import com.workplace.issue.workflow.dto.WorkflowRunCursor;
import com.workplace.issue.workflow.dto.WorkflowRunDetail;
import com.workplace.issue.workflow.dto.WorkflowRunDetail.EventItem;
import com.workplace.issue.workflow.dto.WorkflowRunDetail.NodeRunItem;
import com.workplace.issue.workflow.dto.WorkflowRunPage;
import com.workplace.issue.workflow.exception.WorkflowException;
import com.workplace.issue.workflow.repository.MyTurnRow;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.RunEventRow;
import com.workplace.issue.workflow.repository.RunListRow;
import com.workplace.issue.workflow.repository.RunRow;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRow;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.issue.workflow.repository.WorkflowVersionRow;
import com.workplace.project.dto.ProjectRow;
import com.workplace.project.repository.ProjectRepository;
import com.workplace.project.service.ProjectAccessGuard;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * 워크플로우 실행 목록·상세 조회(WP-1985 설계 §11). 쓰지 않는다.
 *
 * <p>읽기 권한은 이슈 상세 GET 과 같다(설계 §5) — 프로젝트를 읽을 수 없으면 없는 것과 같은 404 이고, 본문은 없음·못 봄·다른 테넌트가 모두 같다. 사람
 * 요약은 쪽(또는 상세) 하나에 한 번만 읽는다(항목 수만큼 질의하지 않는다).
 */
@Service
@Transactional(readOnly = true)
@RequiredArgsConstructor
public class WorkflowRunQueryService {

  /** 실행 상태 값 — 목록 status 거르기는 이 값 하나만 받는다(Global 「workflow_run.status」). */
  private static final Set<String> RUN_STATUSES =
      Set.of("RUNNING", "WAITING", "SUSPENDED", "COMPLETED", "CANCELED");

  /** 쪽 크기 기본값·상한(설계 §11 「30개(최대 100)」). */
  public static final int DEFAULT_SIZE = 30;

  public static final int MAX_SIZE = 100;

  private final WorkflowRepository workflowRepository;
  private final WorkflowRunRepository runRepository;
  private final IssueRepository issueRepository;
  private final ProjectRepository projectRepository;
  private final ProjectAccessGuard accessGuard;
  private final WorkflowModelLoader modelLoader;
  private final WorkflowRunViews views;
  private final ObjectMapper objectMapper;

  /** 내 차례 응답 상한(WP-1991) — 오래 기다린 순으로 이만큼만 준다. */
  public static final int MY_TURNS_MAX = 200;

  /** 저장소에서 한 번에 읽는 쪽 크기 — 거른 뒤 {@link #MY_TURNS_MAX} 가 모이거나 행이 다할 때까지 쪽을 이어 읽는다. */
  private static final int MY_TURNS_PAGE = 50;

  /**
   * 정의의 실행 목록 한 쪽 — 최신순(id 내림차순). 입력 검사(400)는 정의를 읽을 수 있음(404)을 확인한 뒤에 한다 — 못 보는 정의에 대해 입력 오류로 있음을
   * 드러내지 않게.
   *
   * @param status 실행 상태 하나(null 이면 모두)
   * @param node 지금 노드 키(null 이면 모두)
   * @param assigneeId 지금 노드 담당(null 이면 모두)
   * @param cursor 앞 응답의 nextCursor(null 이면 처음)
   * @param size 쪽 크기(null 이면 {@link #DEFAULT_SIZE}, 1~{@link #MAX_SIZE})
   */
  public WorkflowRunPage runs(
      long workflowId,
      String status,
      String node,
      Long assigneeId,
      String cursor,
      Integer size,
      long callerId) {
    WorkflowRow workflow =
        workflowRepository.findById(workflowId).orElseThrow(WorkflowException::notFound);
    ProjectRow project = readableProject(workflow.projectId(), callerId);
    if (status != null && !RUN_STATUSES.contains(status)) {
      throw WorkflowException.invalidRunStatus();
    }
    int limit = size == null ? DEFAULT_SIZE : size;
    if (limit < 1 || limit > MAX_SIZE) {
      throw WorkflowException.invalidPageSize(MAX_SIZE);
    }
    WorkflowRunCursor after = WorkflowRunCursor.decode(cursor);

    // 한 줄 더 읽어 다음 쪽이 있는지 안다.
    List<RunListRow> rows =
        runRepository.findRunsOfWorkflow(
            workflow.id(),
            project.id(),
            status,
            node,
            assigneeId,
            after == null ? null : after.lastId(),
            limit + 1);
    boolean more = rows.size() > limit;
    List<RunListRow> page = more ? rows.subList(0, limit) : rows;

    Set<Long> ids = new LinkedHashSet<>();
    page.forEach(r -> ids.addAll(r.assigneeIds()));
    Map<Long, UserSummary> users = views.users(ids);
    // 버전 모델은 쪽 안의 서로 다른 버전마다 한 번 — 실행 행이 RLS 로 보였으므로 그 버전도 이 테넌트의 것이다(그 뒤에만 캐시).
    Map<Long, WorkflowModel> models = new HashMap<>();

    List<WorkflowRunPage.Item> items = new ArrayList<>();
    for (RunListRow r : page) {
      WorkflowModel model = models.computeIfAbsent(r.versionId(), this::model);
      items.add(
          new WorkflowRunPage.Item(
              r.runId(),
              r.issueId(),
              project.key() + "-" + r.issueNumber(),
              r.title(),
              r.status(),
              r.currentNode(),
              nodeName(model, r.currentNode()),
              WorkflowRunViews.summaries(r.assigneeIds(), users),
              r.enteredAt(),
              r.startedAt(),
              r.versionNo()));
    }
    String next = more ? new WorkflowRunCursor(page.getLast().runId()).encode() : null;
    return new WorkflowRunPage(List.copyOf(items), next);
  }

  /**
   * 실행 한 건의 상세. 실행(RLS) → 이슈(삭제 제외) → 프로젝트 읽기 순으로 보고, 어느 것이든 안 되면 같은 404 다. model 은 버전 조회와 같은 저장
   * JSON 글이다.
   */
  public WorkflowRunDetail detail(long runId, long callerId) {
    RunRow run = runRepository.findRun(runId).orElseThrow(WorkflowException::notFound);
    IssueRow issue =
        issueRepository.findById(run.issueId()).orElseThrow(WorkflowException::notFound);
    ProjectRow project = readableProject(issue.projectId(), callerId);
    // 실행 행이 RLS 로 보였으므로 그 버전도 이 테넌트의 것이다.
    WorkflowVersionRow version =
        workflowRepository
            .findVersionById(run.versionId())
            .orElseThrow(WorkflowException::notFound);
    WorkflowModel model = model(version.id());
    List<NodeRunRow> nodeRuns = runRepository.findNodeRuns(run.id());
    List<RunEventRow> events = runRepository.findEvents(run.id());

    // 사람 요약은 한 번에.
    Set<Long> ids = new LinkedHashSet<>();
    if (run.startedBy() != null) {
      ids.add(run.startedBy());
    }
    for (NodeRunRow r : nodeRuns) {
      ids.addAll(r.assigneeIds());
      ids.addAll(r.workflowAssignedIds());
      if (r.actorId() != null) {
        ids.add(r.actorId());
      }
    }
    events.forEach(
        e -> {
          if (e.actorId() != null) {
            ids.add(e.actorId());
          }
        });
    Map<Long, UserSummary> users = views.users(ids);

    WorkflowRunDetail.Run runView =
        new WorkflowRunDetail.Run(
            run.id(),
            version.workflowId(),
            version.versionNo(),
            issue.id(),
            issue.number(),
            project.key() + "-" + issue.number(),
            issue.title(),
            run.status(),
            run.revision(),
            run.currentNode(),
            WorkflowRunViews.user(run.startedBy(), users),
            run.startedAt(),
            run.endedAt(),
            run.contextJson());
    List<NodeRunItem> visits = new ArrayList<>();
    for (NodeRunRow r : nodeRuns) {
      visits.add(
          new NodeRunItem(
              r.id(),
              r.nodeKey(),
              nodeName(model, r.nodeKey()),
              r.visitNo(),
              r.status(),
              WorkflowRunViews.summaries(r.assigneeIds(), users),
              WorkflowRunViews.summaries(r.workflowAssignedIds(), users),
              r.outcome(),
              r.outputsJson(),
              r.commentId(),
              r.waitingReason(),
              r.error(),
              WorkflowRunViews.user(r.actorId(), users),
              r.enteredAt(),
              r.leftAt(),
              r.viaReturn()));
    }
    List<EventItem> eventItems = new ArrayList<>();
    for (RunEventRow e : events) {
      eventItems.add(
          new EventItem(
              e.id(),
              e.type(),
              e.payloadJson(),
              WorkflowRunViews.user(e.actorId(), users),
              e.at()));
    }
    return new WorkflowRunDetail(
        runView, List.copyOf(visits), List.copyOf(eventItems), version.modelJson());
  }

  /**
   * 내 차례(WP-1991) — 모든 프로젝트에서 내가 담당인 활성 사람 노드(human_task), 오래 기다린 순 최대 {@link #MY_TURNS_MAX}. 읽을 수
   * 없는 프로젝트는 빼고(에러 없이), 노드 종류·이름은 실행이 고정한 버전 모델로 판정한다. 사람 요약은 한 번에 읽는다.
   */
  public List<MyWorkflowTurn> myTurns(long callerId) {
    // 프로젝트 읽기 판정·버전 모델은 서로 다른 값마다 한 번(캐시).
    Map<Long, ProjectRow> projects = new HashMap<>();
    Map<Long, WorkflowModel> models = new HashMap<>();
    List<Turn> kept = new ArrayList<>();
    // 앞쪽에 못 읽는 프로젝트·사람 아닌 노드 행이 많아도 뒤의 진짜 차례가 빠지지 않게 쪽으로 이어 읽는다.
    for (int offset = 0; kept.size() < MY_TURNS_MAX; offset += MY_TURNS_PAGE) {
      List<MyTurnRow> rows = runRepository.findMyActiveTurns(callerId, MY_TURNS_PAGE, offset);
      for (MyTurnRow r : rows) {
        if (kept.size() >= MY_TURNS_MAX) {
          break;
        }
        myTurnOf(r, callerId, projects, models).ifPresent(kept::add);
      }
      if (rows.size() < MY_TURNS_PAGE) {
        break;
      }
    }
    Set<Long> ids = new LinkedHashSet<>();
    kept.forEach(
        t -> {
          if (t.row().handedById() != null) {
            ids.add(t.row().handedById());
          }
        });
    Map<Long, UserSummary> users = views.users(ids);
    List<MyWorkflowTurn> out = new ArrayList<>();
    for (Turn t : kept) {
      MyTurnRow r = t.row();
      ProjectRow project = t.project();
      out.add(
          new MyWorkflowTurn(
              r.runId(),
              r.issueId(),
              r.issueNumber(),
              project.key() + "-" + r.issueNumber(),
              r.title(),
              project.id(),
              project.key(),
              r.workflowId(),
              r.workflowName(),
              r.versionNo(),
              r.nodeKey(),
              nodeName(t.model(), r.nodeKey()),
              r.enteredAt(),
              WorkflowRunViews.user(r.handedById(), users),
              pendingQuestion(r.contextJson(), r.nodeKey())));
    }
    return List.copyOf(out);
  }

  /**
   * 정의의 노드별 진행 중 실행 수(WP-1991). {@link #runs} 처럼 정의 → 읽을 수 있는 프로젝트 순이라 못 읽는 프로젝트·없는 정의는 같은 404 다.
   */
  public WorkflowRunCounts runCounts(long workflowId, long callerId) {
    WorkflowRow workflow =
        workflowRepository.findById(workflowId).orElseThrow(WorkflowException::notFound);
    readableProject(workflow.projectId(), callerId);
    return new WorkflowRunCounts(runRepository.countActiveByNode(workflow.id()));
  }

  /**
   * context 의 {@code _qa} 를 뒤에서부터 훑어 answerNode 가 지금 노드이고 answer 가 없으며 question 이 글인 첫 항목의 질문(없으면
   * null). 마지막 항목이 다른 노드의 질문이어도 그 앞의 지금 노드 질문을 찾는다 — 웹 IssueWorkflowBanner 의 pendingQuestion 과 같은
   * 규칙이다.
   */
  private String pendingQuestion(String contextJson, String nodeKey) {
    try {
      JsonNode qa = objectMapper.readTree(contextJson).get("_qa");
      if (qa == null || !qa.isArray()) {
        return null;
      }
      for (int i = qa.size() - 1; i >= 0; i--) {
        // 항목 하나가 깨져도(객체가 아님·글이 아닌 값) 건너뛰고 앞 항목을 계속 본다.
        JsonNode e = qa.get(i);
        if (e == null || !e.isObject()) {
          continue;
        }
        JsonNode answerNode = e.get("answerNode");
        JsonNode answer = e.get("answer");
        JsonNode question = e.get("question");
        boolean pending =
            answerNode != null
                && answerNode.isString()
                && nodeKey.equals(answerNode.asString())
                && (answer == null || answer.isNull());
        if (pending && question != null && question.isString()) {
          return question.asString();
        }
      }
      return null;
    } catch (RuntimeException e) {
      // 깨진 context 는 질문 없음으로 본다 — 목록 전체가 실패하지 않게.
      return null;
    }
  }

  /** 내 차례로 판정된 행과 그 행의 (읽을 수 있는) 프로젝트·실행 버전 모델. */
  private record Turn(MyTurnRow row, ProjectRow project, WorkflowModel model) {}

  /**
   * 한 행이 내 차례인지 판정해 맞으면 돌려준다 — 프로젝트를 읽을 수 있고 지금 노드가 사람 노드(human_task)여야 한다. 프로젝트·모델은 캐시(값마다 한 번만
   * 읽음)에 담는다. 못 읽는 프로젝트는 빈 값이다.
   */
  private Optional<Turn> myTurnOf(
      MyTurnRow r, long callerId, Map<Long, ProjectRow> projects, Map<Long, WorkflowModel> models) {
    ProjectRow project =
        projects.computeIfAbsent(
            r.projectId(),
            id ->
                projectRepository
                    .findById(id)
                    .filter(p -> accessGuard.canRead(p, callerId))
                    .orElse(null));
    if (project == null) {
      return Optional.empty();
    }
    WorkflowModel model = models.computeIfAbsent(r.versionId(), this::model);
    Node node = model.nodes().get(r.nodeKey());
    return node != null && NodeTypes.HUMAN_TASK.equals(node.type())
        ? Optional.of(new Turn(r, project, model))
        : Optional.empty();
  }

  // ───────────────────────── 도우미 ─────────────────────────

  /** 읽을 수 있는 프로젝트 — 없거나 못 보면 없는 워크플로우·실행과 같은 404(정의 조회와 같은 본문). */
  private ProjectRow readableProject(long projectId, long callerId) {
    return projectRepository
        .findById(projectId)
        .filter(p -> accessGuard.canRead(p, callerId))
        .orElseThrow(WorkflowException::notFound);
  }

  /** 버전 모델 사본(캐시). 부르는 쪽이 RLS 로 그 실행이 보인 것을 확인한 뒤에만 부른다. */
  private WorkflowModel model(long versionId) {
    return modelLoader.get(versionId);
  }

  /** 모델의 노드 이름(노드가 없거나 키가 null 이면 null). */
  private static String nodeName(WorkflowModel model, String key) {
    if (key == null) {
      return null;
    }
    Node n = model.nodes().get(key);
    return n == null ? null : n.name();
  }
}
