package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AGENT_SERVER_RUN;
import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.security.AgentToolContext;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.dto.ServerAgentRunReport;
import com.workplace.issue.outbound.AgentWorkNoticeEvent;
import com.workplace.issue.outbound.AgentsResumedByChatReply;
import com.workplace.issue.outbound.IssueDomainEvents.IssueAssignedEvent;
import com.workplace.issue.outbound.IssueHumanReplyPosted;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeWakeEvent;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowRunEnded;
import com.workplace.issue.service.ServerAgentRunService;
import com.workplace.issue.workflow.dto.MoveRequest;
import com.workplace.issue.workflow.service.WorkflowRunService;
import com.workplace.notify.outbound.NotificationDispatcher;
import com.workplace.notify.service.NotificationService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1986 노드 진입·떠남 다리 — 워크플로우가 AI 를 노드에 넣으면 agent_work 를 열고(외부 AI SUBMITTED) 깨우며, 노드를 떠나면 그 AI 의
 * 작업을 COMPLETED(질문으로 떠나면 INPUT_REQUIRED)로 둔다.
 *
 * <p>요청은 시험 트랜잭션에 합류하고 롤백된다. 커밋 뒤 소비자(ai-agent 발사·ASSIGNED 알림)는 돌지 않으므로 깨우기는 기록된 {@link
 * IssueAssignedEvent}(wakeAgent=true)로 본다. agent_work 는 같은 트랜잭션의 동기 리스너가 바꾸므로 행으로 단언한다.
 */
@RecordApplicationEvents
@Transactional
class WorkflowAgentWorkTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired ApplicationEvents events;
  @Autowired ApplicationEventPublisher publisher;
  @Autowired WorkflowRunService runService;
  @Autowired AgentApiKeyService agentKeyService;
  @Autowired ServerAgentRunService serverAgentRunService;
  @Autowired NotificationService notificationService;

  /** 프로젝트 OWNER(관리자) — 모든 노드를 옮길 수 있다(override). */
  private long pm;

  private long lead;
  private String key;
  private long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    lead = human();
    key = "WA" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
    projectId = projectService.create(pm, new CreateProjectRequest(key, "다리", "x", "TEAM")).id();
    TenantContext.set(1L);
    projectService.addMember(pm, key, new AddMemberRequest(lead, "MEMBER"));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────── 진입 ─────────────────────────

  @Test
  @DisplayName("agent_task 에 들어가면 외부 AI 에게 SUBMITTED 하나를 열고 깨우기 이벤트를 낸다")
  void enterAgentTask_opensSubmitted_andWakes() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    events.clear();

    ok(startReq(issue, wf), pm);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    List<WorkflowNodeWakeEvent> wakes = wakes();
    assertThat(wakes).hasSize(1);
    assertThat(wakes.getFirst().agentIds()).containsExactly(bot);
    assertThat(wakes.getFirst().actorId()).isEqualTo(pm);
    assertThat(wakes.getFirst().nodeKey()).isEqualTo("work");
    // 담당 지정 이벤트로 깨우지 않는다 — 깨우기는 전용 이벤트만.
    assertThat(events.stream(IssueAssignedEvent.class).filter(IssueAssignedEvent::wakeAgent))
        .isEmpty();
  }

  @Test
  @DisplayName("워크플로우가 새로 넣은 외부 AI 는 진입마다 ASSIGNED 를 한 번만 받는다(담당 변경이 알리고 깨우기 알림은 뺀다)")
  void newlyAddedAgent_assignedNotifiedOnce() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    events.clear();

    ok(startReq(issue, wf), pm);

    // 담당 변경 이벤트(ASSIGNED 알림 소스)의 added 에 bot 이 한 번.
    assertThat(
            events.stream(IssueAssignedEvent.class)
                .flatMap(a -> a.added().stream())
                .filter(u -> u.id() == bot))
        .hasSize(1);
    // 깨우기 이벤트는 bot 을 이미 알림 받은 사람으로 실어 알림 소비자가 뺀다.
    assertThat(wakes().getFirst().alreadyNotifiedIds()).containsExactly(bot);
  }

  @Test
  @DisplayName("이미 담당인 AI 가 다음 노드에 들어가면 담당 변경 알림이 없으므로 깨우기 알림 대상이다")
  void keptAgent_notInAlreadyNotified() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    events.clear();

    ok(move(issue, "work", "again", null, 0, "k1"), pm);

    assertThat(events.stream(IssueAssignedEvent.class)).isEmpty();
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().alreadyNotifiedIds()).doesNotContain(bot);
  }

  @Test
  @DisplayName(
      "외부 AI 가 자기 노드에서 자기가 맡은 다음 노드로 이동하면 그 AI 에게 ASSIGNED 가 정확히 1건 가고 작업이 SUBMITTED 로 열린다")
  void externalAgentMovesToOwnNextNode_isNotified() {
    long bot = agent("EXTERNAL");
    // 실제 AI 는 issue:write 를 가진 역할로 등록된다 — 직접 이동하려면 USER 역할이 필요하다.
    TestFixtures.grantRole(dsl, bot, "USER");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    events.clear();

    // 노드 담당 외부 AI(bot)가 직접 넘긴다 — 같은 AI 가 다음 노드(work2)도 맡는다.
    expectAsAgent(move(issue, "work", "again", null, 0, "k-self"), bot);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().actorId()).isEqualTo(bot);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
    // 이 시험 트랜잭션은 커밋되지 않아 커밋 뒤 리스너가 돌지 않는다 — 이 스레드에서 새로 만든 dispatcher 로 소비자를 직접 부른다.
    new NotificationDispatcher(notificationService).onWorkflowNodeWake(wakes().getFirst());
    assertThat(assignedNotifications(issue, bot)).isEqualTo(1);
  }

  @Test
  @DisplayName("내부 AI 가 자기 노드에서 자기가 맡은 다음 노드로 이동하면 깨우기는 나가도 자기에게 ASSIGNED 알림은 가지 않는다")
  void internalAgentMovesToOwnNextNode_notNotified() {
    long bot = agent("INTERNAL");
    long wf = publish(yaml(bot, agent("INTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    events.clear();

    // 노드 담당 내부 AI(bot)가 직접 넘긴다 — 같은 AI 가 다음 노드(work2)도 맡는다.
    runService.move(
        issue, new MoveRequest("work", "again", null, null, null, 0, "k-self-int"), bot);

    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().actorId()).isEqualTo(bot);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
    // 내부 AI 는 ai-agent 발사로 깨어난다 — 깨우기 알림은 행위자인 내부 AI 를 받는 사람에서 뺀다.
    new NotificationDispatcher(notificationService).onWorkflowNodeWake(wakes().getFirst());
    assertThat(assignedNotifications(issue, bot)).isZero();
  }

  @Test
  @DisplayName("사람이 AI 노드로 이동시키면 AI 는 ASSIGNED 를 1건만 받는다(기존과 같음)")
  void humanMovesToAgentNode_assignedOnce() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    events.clear();

    ok(move(issue, "work", "again", null, 0, "k-human"), pm);

    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().actorId()).isEqualTo(pm);
    new NotificationDispatcher(notificationService).onWorkflowNodeWake(wakes().getFirst());
    assertThat(assignedNotifications(issue, bot)).isEqualTo(1);
  }

  @Test
  @DisplayName("AI 가 일으킨 이동으로 내부 AI 노드에 들어가면 그 노드의 AI 를 깨우는 이벤트가 나간다")
  void agentActorMove_intoInternalAgentNode_wakesNodeAgent() {
    long bot = agent("INTERNAL");
    long bot2 = agent("INTERNAL");
    long wf = publish(yaml(bot, bot2));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    events.clear();

    // 노드 담당 AI(bot)가 직접 넘긴다 — 서비스 호출(요청자 = bot).
    runService.move(issue, new MoveRequest("work", "handoff", null, null, null, 0, "k-ai"), bot);

    List<WorkflowNodeWakeEvent> wakes = wakes();
    assertThat(wakes).hasSize(1);
    assertThat(wakes.getFirst().agentIds()).containsExactly(bot2);
    assertThat(wakes.getFirst().actorId()).isEqualTo(bot);
    assertThat(wakes.getFirst().nodeKey()).isEqualTo("work3");
  }

  @Test
  @DisplayName("사람만 담당인 노드에 들어가면 agent_work·깨우기가 없다")
  void enterHumanTask_noAgentWorkNoWake() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    events.clear();

    ok(move(issue, "work", "done", null, 0, "k1"), pm);

    assertThat(wakes()).isEmpty();
    assertThat(activeStates(issue, lead)).isEmpty();
  }

  @Test
  @DisplayName("내부 AI 는 깨우기 이벤트만 나가고 SUBMITTED 행은 없다")
  void internalAgent_wakesWithoutSubmitted() {
    long bot = agent("INTERNAL");
    long wf = publish(yaml(bot, agent("INTERNAL")));
    long issue = issue(lead);
    events.clear();

    ok(startReq(issue, wf), pm);

    assertThat(allStates(issue, bot)).isEmpty();
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
  }

  // ───────────────────────── 떠남 ─────────────────────────

  @Test
  @DisplayName("ask 로 떠나면 AI 작업은 INPUT_REQUIRED 로 남고 실행은 WAITING")
  void askMove_keepsInputRequired_runWaiting() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);

    JsonNode v = ok(move(issue, "work", "ask", "어느 쪽으로 할까요?", 0, "k1"), pm);

    assertThat(v.get("status").asString()).isEqualTo("WAITING");
    assertThat(runStatus(issue)).isEqualTo("WAITING");
    assertThat(activeStates(issue, bot)).containsExactly("INPUT_REQUIRED");
    assertThat(allStates(issue, bot)).doesNotContain("CANCELED", "COMPLETED");
  }

  @Test
  @DisplayName("답변 노드의 answered 로 돌아오면 같은 AI 의 행이 SUBMITTED 로 돌아가고 한 번 더 깨운다")
  void answered_wakesSameAgentAgain() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    events.clear();
    ok(startReq(issue, wf), pm);
    ok(move(issue, "work", "ask", "어느 쪽으로 할까요?", 0, "k1"), pm);
    long rowId = activeRowId(issue, bot);

    JsonNode v = ok(move(issue, "work_ask", "answered", "A 로 해 주세요", 1, "k2"), pm);

    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("work");
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    // 새 행이 아니라 같은 행을 되돌린다.
    assertThat(activeRowId(issue, bot)).isEqualTo(rowId);
    List<WorkflowNodeWakeEvent> wakes = wakes();
    assertThat(wakes).hasSize(2);
    assertThat(wakes.get(1).agentIds()).containsExactly(bot);
    // 질문 때 담당에서 빠졌다가 답으로 다시 들어왔으니 담당 변경이 이미 알렸다.
    assertThat(wakes.get(1).alreadyNotifiedIds()).containsExactly(bot);
  }

  @Test
  @DisplayName("다음 노드로 옮기면 떠난 AI 의 작업은 COMPLETED 로 끝나고 CANCELED 가 아니다")
  void moveToNext_closesAgentWorkCompleted_notCanceled() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);

    ok(move(issue, "work", "done", null, 0, "k1"), pm);

    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
  }

  @Test
  @DisplayName("다른 AI 노드로 넘기면 떠난 AI 는 COMPLETED, 받은 AI 는 SUBMITTED 와 깨우기")
  void handoffToOtherAgent_completesAndOpens() {
    long bot = agent("EXTERNAL");
    long bot2 = agent("EXTERNAL");
    long wf = publish(yaml(bot, bot2));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    events.clear();

    ok(move(issue, "work", "handoff", null, 0, "k1"), pm);

    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
    assertThat(activeStates(issue, bot2)).containsExactly("SUBMITTED");
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot2);
    // 워크플로우가 넣은 bot 은 이슈 담당에서 빠진다.
    assertThat(issueAssignees(issue)).doesNotContain(bot).contains(bot2);
  }

  @Test
  @DisplayName("같은 AI 가 다음 노드도 맡으면 떠난 행은 COMPLETED, 새 SUBMITTED 하나가 열린다")
  void keepSameAgent_nextNode_reopensSubmitted() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    long first = activeRowId(issue, bot);
    events.clear();

    JsonNode v = ok(move(issue, "work", "again", null, 0, "k1"), pm);

    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("work2");
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeRowId(issue, bot)).isNotEqualTo(first);
    assertThat(allStates(issue, bot)).containsExactlyInAnyOrder("COMPLETED", "SUBMITTED");
    assertThat(wakes()).hasSize(1);
  }

  @Test
  @DisplayName("사람이 손으로 넣은 AI 담당은 이동 뒤에도 이슈 담당에 남는다")
  void manualAssignee_survivesMove() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead, bot);
    ok(startReq(issue, wf), pm);

    ok(move(issue, "work", "done", null, 0, "k1"), pm);

    assertThat(issueAssignees(issue)).contains(bot, lead);
    // 노드를 떠났으니 그 노드의 작업은 끝났다(취소가 아니다).
    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
  }

  // ───────────────────────── 챗 답 ─────────────────────────

  @Test
  @DisplayName("워크플로우 이슈에서는 사람의 챗 답이 INPUT_REQUIRED 를 되살리지 않는다")
  void humanReply_onWorkflowIssue_doesNotResumeInputRequired() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    ok(move(issue, "work", "ask", "어느 쪽으로 할까요?", 0, "k1"), pm);

    publisher.publishEvent(new IssueHumanReplyPosted(issue, lead, List.of()));

    assertThat(activeStates(issue, bot)).containsExactly("INPUT_REQUIRED");
  }

  @Test
  @DisplayName("워크플로우가 없는 이슈의 챗 답은 지금처럼 INPUT_REQUIRED 를 작업 중으로 되돌린다")
  void humanReply_withoutRun_stillResumes() {
    long bot = agent("EXTERNAL");
    long issue = issue(lead, bot);
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.STATE, "INPUT_REQUIRED")
        .where(AGENT_WORK.ISSUE_ID.eq(issue))
        .and(AGENT_WORK.WORKER_ID.eq(bot))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .execute();

    publisher.publishEvent(new IssueHumanReplyPosted(issue, lead, List.of()));

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
  }

  @Test
  @DisplayName("워크플로우 이슈에 손으로 넣은 AI 의 답변 필요는 챗 답이 지금처럼 되살리고 깨운다 — 질문 이동으로 묻는 노드 AI 만 남는다")
  void humanReply_manualAgentOnWorkflowIssue_resumes() {
    long bot = agent("EXTERNAL");
    long other = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead, other);
    ok(startReq(issue, wf), pm);
    // 손으로 넣은 AI 는 노드 담당이 아니라 답변 필요 보고가 지금처럼 받아진다.
    reportOk(issue, other, "INPUT_REQUIRED", null, "어디에 배포할까요?");
    // 노드 AI 는 질문 이동으로 묻는다 — 그 답은 답변 노드의 answered 이동이다.
    ok(move(issue, "work", "ask", "어느 쪽으로 할까요?", 0, "k1"), pm);
    events.clear();

    publisher.publishEvent(new IssueHumanReplyPosted(issue, lead, List.of()));

    assertThat(activeStates(issue, other)).containsExactly("WORKING");
    assertThat(activeStates(issue, bot)).containsExactly("INPUT_REQUIRED");
    List<AgentsResumedByChatReply> resumed = events.stream(AgentsResumedByChatReply.class).toList();
    assertThat(resumed).hasSize(1);
    assertThat(resumed.getFirst().workerIds()).containsExactly(other);
  }

  @Test
  @DisplayName("실행이 decision 에 멈춘 동안 노드였던 AI 가 답변 필요를 보고하면 챗 답이 되살리고 깨운다")
  void humanReply_whileRunOnDecision_resumesNodeAgent() {
    long bot = agent("EXTERNAL");
    long wf = publish(chainYaml(bot, 21));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    // 노드 AI 가 직접 넘겨 decision 연쇄가 한도(20)를 넘어 d21 에서 멈춘다 — 이슈 담당은 그대로라 bot 이 남는다.
    runService.move(issue, new MoveRequest("work", "go", null, null, null, 0, "k-chain"), bot);
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    // 지금 노드가 decision 이라 bot 은 노드 담당이 아니다 — 답변 필요 보고가 받아진다.
    reportOk(issue, bot, "INPUT_REQUIRED", null, "어떻게 할까요?");
    assertThat(activeStates(issue, bot)).containsExactly("INPUT_REQUIRED");
    events.clear();

    publisher.publishEvent(new IssueHumanReplyPosted(issue, lead, List.of()));

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    List<AgentsResumedByChatReply> resumed = events.stream(AgentsResumedByChatReply.class).toList();
    assertThat(resumed).hasSize(1);
    assertThat(resumed.getFirst().workerIds()).containsExactly(bot);
  }

  // ───────────────────────── 작업 보고 ─────────────────────────

  @Test
  @DisplayName("노드 담당 AI 의 작업 중 보고는 노드·실행을 그대로 둔다")
  void reportWorking_keepsNodeActive() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    reportOk(issue, bot, "WORKING", "하는 중", null);

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isZero();
  }

  @Test
  @DisplayName("노드 담당 AI 가 차단됨을 보고하면 node_run BLOCKED·실행 SUSPENDED(revision +1)·NODE_BLOCKED 이벤트")
  void reportBlocked_nodeBlocked_runSuspended() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    reportOk(issue, bot, "BLOCKED", "저장소 권한이 없습니다", null);

    var node = nodeRun(issue, "work");
    assertThat(node.get(NODE_RUN.STATUS)).isEqualTo("BLOCKED");
    assertThat(node.get(NODE_RUN.WAITING_REASON)).isEqualTo("BLOCKED");
    assertThat(node.get(NODE_RUN.ERROR)).isEqualTo("저장소 권한이 없습니다");
    // 막힌 방문은 지금 방문으로 남는다 — 조치(다시 시도)가 닫는다.
    assertThat(node.get(NODE_RUN.LEFT_AT)).isNull();
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runRevision(issue)).isEqualTo(1);
    assertThat(runEvents(issue)).contains("NODE_BLOCKED");
    // agent_work 는 지금처럼 저장된다.
    assertThat(activeStates(issue, bot)).containsExactly("BLOCKED");
  }

  @Test
  @DisplayName("권한 필요 보고도 node_run BLOCKED(waiting_reason AUTH_REQUIRED)·실행 SUSPENDED")
  void reportAuthRequired_nodeBlocked() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    reportOk(issue, bot, "AUTH_REQUIRED", "로그인이 필요합니다", null);

    var node = nodeRun(issue, "work");
    assertThat(node.get(NODE_RUN.STATUS)).isEqualTo("BLOCKED");
    assertThat(node.get(NODE_RUN.WAITING_REASON)).isEqualTo("AUTH_REQUIRED");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(activeStates(issue, bot)).containsExactly("AUTH_REQUIRED");
  }

  @Test
  @DisplayName(
      "노드 담당 AI 의 실패 보고는 node_run FAILED·실행 SUSPENDED·NODE_FAILED, agent_work 는 FAILED 로 끝난다")
  void reportFailed_nodeFailed_runSuspended() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    reportOk(issue, bot, "FAILED", "빌드가 깨졌습니다", null);

    var node = nodeRun(issue, "work");
    assertThat(node.get(NODE_RUN.STATUS)).isEqualTo("FAILED");
    assertThat(node.get(NODE_RUN.WAITING_REASON)).isNull();
    assertThat(node.get(NODE_RUN.ERROR)).isEqualTo("빌드가 깨졌습니다");
    assertThat(node.get(NODE_RUN.LEFT_AT)).isNull();
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runRevision(issue)).isEqualTo(1);
    assertThat(runEvents(issue)).contains("NODE_FAILED");
    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("FAILED");
  }

  @Test
  @DisplayName("대기 중 보고는 노드·실행을 그대로 둔다")
  void reportWaiting_nodeStaysActive() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    reportOk(issue, bot, "WAITING", "CI 를 기다립니다", null);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isZero();
  }

  @Test
  @DisplayName("노드 담당 AI 가 사람에게 보낸 대기 중 보고도 답변 필요로 바꾸지 않는다(질문은 이동의 ask 로만)")
  void reportWaiting_addressingHuman_staysWaitingOnWorkflowIssue() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    reportOk(issue, bot, "WAITING", null, "<@" + lead + "> 확인 부탁드립니다");

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
  }

  @Test
  @DisplayName("노드 담당 AI 의 답변 필요 직접 보고는 409 WORKFLOW_USE_MOVE 이고 아무것도 바뀌지 않는다")
  void reportInputRequiredDirectly_rejectedWithUseMove() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);
    String statusBefore = issueStatus(issue);

    JsonNode body = report(issue, bot, "INPUT_REQUIRED", null, "어느 쪽으로 할까요?", 409);

    assertThat(body.get("errors").get("code").asString()).isEqualTo("WORKFLOW_USE_MOVE");
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(issueStatus(issue)).isEqualTo(statusBefore);
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runRevision(issue)).isZero();
  }

  @Test
  @DisplayName("노드 담당 AI 의 검토 대기 보고도 워크플로우 이슈에서는 409 WORKFLOW_USE_MOVE")
  void reportReview_rejectedOnWorkflowIssue() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);
    String statusBefore = issueStatus(issue);

    JsonNode body = report(issue, bot, "REVIEW", "검토해 주세요", null, 409);

    assertThat(body.get("errors").get("code").asString()).isEqualTo("WORKFLOW_USE_MOVE");
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(issueStatus(issue)).isEqualTo(statusBefore);
  }

  @Test
  @DisplayName("지금 노드 담당이 아닌 AI(손으로 넣은 담당)의 차단 보고는 실행에 반영하지 않고 agent_work 만 저장한다")
  void reportBlocked_byNonNodeAgent_doesNotSuspend() {
    long bot = agent("EXTERNAL");
    long other = agent("EXTERNAL");
    long wf = publish(yaml(bot, other));
    long issue = issue(lead, other);
    ok(startReq(issue, wf), pm);

    reportOk(issue, other, "BLOCKED", "막혔습니다", null);

    assertThat(activeStates(issue, other)).containsExactly("BLOCKED");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isZero();
    assertThat(runEvents(issue)).doesNotContain("NODE_BLOCKED");
  }

  @Test
  @DisplayName("이미 멈춘 실행에 차단을 다시 보고해도 revision·이벤트가 겹치지 않는다")
  void reportBlockedTwice_suspendsOnce() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);
    reportOk(issue, bot, "BLOCKED", "첫 번째", null);

    reportOk(issue, bot, "BLOCKED", "두 번째", null);

    assertThat(runRevision(issue)).isEqualTo(1);
    assertThat(runEvents(issue).stream().filter("NODE_BLOCKED"::equals)).hasSize(1);
    assertThat(nodeRun(issue, "work").get(NODE_RUN.ERROR)).isEqualTo("첫 번째");
  }

  @Test
  @DisplayName("워크플로우가 없는 이슈의 검토 대기 보고는 지금처럼 저장된다")
  void reportReview_withoutRun_unchanged() {
    long bot = agent("EXTERNAL");
    long issue = issue(lead, bot);

    reportOk(issue, bot, "REVIEW", "검토해 주세요", null);

    assertThat(activeStates(issue, bot)).containsExactly("REVIEW");
  }

  @Test
  @DisplayName("노드 담당 AI 의 완료·취소·반려 보고는 409 WORKFLOW_USE_MOVE 이고 작업·노드·실행이 그대로다(원장 R9)")
  void reportTerminal_byNodeAgent_rejectedWithUseMove() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    for (String state : List.of("COMPLETED", "CANCELED", "REJECTED")) {
      JsonNode body = report(issue, bot, state, "끝났습니다", null, 409);

      assertThat(body.get("errors").get("code").asString())
          .as(state)
          .isEqualTo("WORKFLOW_USE_MOVE");
      assertThat(activeStates(issue, bot)).as(state).containsExactly("SUBMITTED");
      assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).as(state).isEqualTo("ACTIVE");
      assertThat(runStatus(issue)).as(state).isEqualTo("RUNNING");
      assertThat(runRevision(issue)).as(state).isZero();
    }
  }

  @Test
  @DisplayName("지금 노드 담당이 아닌 AI(손으로 넣은 담당)의 완료 보고는 지금처럼 작업을 닫는다")
  void reportCompleted_byNonNodeAgent_unchanged() {
    long bot = agent("EXTERNAL");
    long other = agent("EXTERNAL");
    long wf = publish(yaml(bot, other));
    long issue = issue(lead, other);
    ok(startReq(issue, wf), pm);

    reportOk(issue, other, "WORKING", "하는 중", null);
    reportOk(issue, other, "COMPLETED", "끝났습니다", null);

    assertThat(activeStates(issue, other)).isEmpty();
    assertThat(allStates(issue, other)).last().isEqualTo("COMPLETED");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runRevision(issue)).isZero();
  }

  @Test
  @DisplayName("워크플로우가 없는 이슈의 완료·반려 보고는 지금처럼 작업을 닫는다")
  void reportTerminal_withoutRun_unchanged() {
    long bot = agent("EXTERNAL");
    long bot2 = agent("EXTERNAL");
    long issue = issue(lead, bot, bot2);

    reportOk(issue, bot, "WORKING", "하는 중", null);
    reportOk(issue, bot2, "WORKING", "하는 중", null);
    reportOk(issue, bot, "COMPLETED", "끝났습니다", null);
    reportOk(issue, bot2, "REJECTED", "할 수 없습니다", null);

    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).last().isEqualTo("COMPLETED");
    assertThat(allStates(issue, bot2)).last().isEqualTo("REJECTED");
  }

  // ───────────────────────── 담당 지정 ─────────────────────────

  @Test
  @DisplayName("워크플로우를 켜지 않은 프로젝트에서 외부 AI 를 담당으로 넣으면 지금처럼 SUBMITTED 를 열고 깨운다")
  void disabledProject_assignStillWakes() {
    long bot = agent("EXTERNAL");
    long issue = issue(lead);
    events.clear();

    ok(assign(issue, null, lead, bot), pm);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    List<IssueAssignedEvent> assigned = events.stream(IssueAssignedEvent.class).toList();
    assertThat(assigned).hasSize(1);
    assertThat(assigned.getFirst().wakeAgent()).isTrue();
    assertThat(assigned.getFirst().added()).anyMatch(u -> u.id() == bot);
  }

  @Test
  @DisplayName("켠 프로젝트에서 담당 지정은 깨우지도 SUBMITTED 를 열지도 않고, 시작하면 그때 SUBMITTED 와 깨우기")
  void enabledProject_assignDoesNotWake_untilStart() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    events.clear();

    ok(assign(issue, null, lead, bot), pm);

    assertThat(allStates(issue, bot)).isEmpty();
    List<IssueAssignedEvent> assigned = events.stream(IssueAssignedEvent.class).toList();
    // ASSIGNED 알림의 소스인 담당 변경 이벤트는 그대로 나가고, 깨우기 표시만 꺼진다.
    assertThat(assigned).hasSize(1);
    assertThat(assigned.getFirst().wakeAgent()).isFalse();
    assertThat(assigned.getFirst().added()).anyMatch(u -> u.id() == bot);
    assertThat(wakes()).isEmpty();

    ok(startReq(issue, wf), pm);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
  }

  @Test
  @DisplayName("활성 실행이 있는 이슈는 정의를 끈 뒤에도 담당 지정이 깨우지 않는다")
  void activeRun_assignDoesNotWake_evenIfWorkflowDisabled() {
    long bot = agent("EXTERNAL");
    long other = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    ok(patch(API + "/workflows/" + wf).content(json("enabled", false)), pm);
    events.clear();

    ok(assign(issue, null, lead, bot, other), pm);

    assertThat(allStates(issue, other)).isEmpty();
    assertThat(events.stream(IssueAssignedEvent.class).filter(IssueAssignedEvent::wakeAgent))
        .isEmpty();
  }

  @Test
  @DisplayName("담당 교체에 startWorkflowId 를 실으면 같은 요청에서 바로 시작해 노드에 들어가고 깨운다")
  void assignWithStartWorkflowId_startsImmediately() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue();
    events.clear();

    JsonNode body = ok(assign(issue, wf, lead), pm);

    // 응답은 시작이 넣은 노드 담당까지 반영한 최종 담당 목록이다.
    List<Long> ids = new ArrayList<>();
    body.forEach(u -> ids.add(u.get("id").asLong()));
    assertThat(ids).contains(lead, bot);
    JsonNode view = ok(get(API + "/issues/" + issue + "/workflow"), pm);
    assertThat(view.get("status").asString()).isEqualTo("RUNNING");
    assertThat(view.get("currentNode").get("key").asString()).isEqualTo("work");
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
    // 담당 교체 자체는 깨우지 않는다 — 깨우기는 노드 진입이 한다.
    assertThat(events.stream(IssueAssignedEvent.class).filter(IssueAssignedEvent::wakeAgent))
        .isEmpty();
  }

  @Test
  @DisplayName("startWorkflowId 로 시작할 수 없으면(시작 역할 없음) 시작 오류를 그대로 돌려준다")
  void assignWithStartWorkflowId_noStartMatch_returnsStartError() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue();

    JsonNode body = expect(assign(issue, wf, pm), pm, 422);

    assertThat(body.get("errors").get("code").asString()).isEqualTo("WORKFLOW_NO_START_MATCH");
  }

  @Test
  @DisplayName("담당 교체에 시작 노드의 AI 와 startWorkflowId 를 함께 실으면 그 AI 는 ASSIGNED 를 한 번만 받는다(원장 R3)")
  void assignWithStartWorkflowId_includingStartAgent_assignedNotifiedOnce() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue();
    events.clear();

    ok(assign(issue, wf, lead, bot), pm);

    // 담당 교체가 bot 에게 ASSIGNED 를 한 번 알린다(담당 변경 이벤트의 added).
    assertThat(
            events.stream(IssueAssignedEvent.class)
                .flatMap(a -> a.added().stream())
                .filter(u -> u.id() == bot))
        .hasSize(1);
    // 시작 노드 진입의 깨우기 알림은 bot 을 이미 알림 받은 사람으로 실어 다시 보내지 않는다.
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
    assertThat(wakes().getFirst().alreadyNotifiedIds()).contains(bot);
  }

  @Test
  @DisplayName("외부 AI 가 스스로 담당하고 startWorkflowId 로 시작하면(시작 노드도 자기) ASSIGNED 가 정확히 1건 가 깨어난다")
  void agentStartsWorkflowOnItself_assignedOnce() {
    long bot = agent("EXTERNAL");
    TestFixtures.grantRole(dsl, bot, "USER");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue();
    events.clear();

    expectAsAgent(assign(issue, wf, lead, bot), bot);

    dispatchNotices();
    assertThat(assignedNotifications(issue, bot)).isEqualTo(1);
  }

  @Test
  @DisplayName("사람이 같은 AI 를 담당으로 넣고 시작해도 AI 는 ASSIGNED 를 1건만 받는다(중복 없음)")
  void humanStartsWorkflowForAgent_assignedOnce() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue();
    events.clear();

    ok(assign(issue, wf, lead, bot), pm);

    dispatchNotices();
    assertThat(assignedNotifications(issue, bot)).isEqualTo(1);
  }

  /** 커밋 뒤 리스너가 돌지 않는 시험 트랜잭션이라, 담당 변경·깨우기 이벤트를 소비자에게 직접 넘긴다. */
  private void dispatchNotices() {
    var dispatcher = new NotificationDispatcher(notificationService);
    events.stream(IssueAssignedEvent.class).forEach(dispatcher::onIssueAssigned);
    wakes().forEach(dispatcher::onWorkflowNodeWake);
  }

  // ───────────────────────── 이슈 닫기 ─────────────────────────

  @Test
  @DisplayName("이슈를 완료하면 실행·열린 node_run 이 CANCELED 가 되고 AI 작업도 닫히며 RunEnded(CANCELED) 를 낸다")
  void issueDone_cancelsRunAndAgentWork() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);
    events.clear();

    ok(issuePatch(issue, "DONE"), pm);

    assertThat(runStatus(issue)).isEqualTo("CANCELED");
    assertThat(runEndedAt(issue)).isNotNull();
    assertThat(runRevision(issue)).isEqualTo(1);
    var node = nodeRun(issue, "work");
    assertThat(node.get(NODE_RUN.STATUS)).isEqualTo("CANCELED");
    assertThat(node.get(NODE_RUN.LEFT_AT)).isNotNull();
    assertThat(runEvents(issue)).contains("RUN_CANCELED");
    // 착수 전(SUBMITTED)이던 작업은 완료 규칙대로 CANCELED 로 닫힌다(지금 규칙 그대로).
    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("CANCELED");
    List<WorkflowRunEnded> ended = events.stream(WorkflowRunEnded.class).toList();
    assertThat(ended).hasSize(1);
    assertThat(ended.getFirst().status()).isEqualTo("CANCELED");
    assertThat(ended.getFirst().issueId()).isEqualTo(issue);
  }

  @Test
  @DisplayName("이슈를 지우면 실행이 CANCELED 가 된다")
  void issueDelete_cancelsRun() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);

    expect(delete(API + "/projects/" + key + "/issues/" + issueNumber(issue)), pm, 204);

    assertThat(runStatus(issue)).isEqualTo("CANCELED");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("CANCELED");
  }

  @Test
  @DisplayName("다시 열어도 실행은 CANCELED 그대로이고 새로 시작할 수 있다")
  void reopen_doesNotReviveRun() {
    long bot = agent("EXTERNAL");
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    ok(issuePatch(issue, "DONE"), pm);

    ok(issuePatch(issue, "TODO"), pm);

    JsonNode view = ok(get(API + "/issues/" + issue + "/workflow"), pm);
    assertThat(view.get("status").asString()).isEqualTo("CANCELED");
    assertThat(activeStates(issue, bot)).isEmpty();
    JsonNode restarted = ok(startReq(issue, wf), pm);
    assertThat(restarted.get("status").asString()).isEqualTo("RUNNING");
  }

  @Test
  @DisplayName("실행이 없는 이슈를 닫으면 오류 없이 지금 AI 작업 규칙 그대로다")
  void issueDone_withoutRun_unchanged() {
    long bot = agent("EXTERNAL");
    long issue = issue(lead, bot);
    events.clear();

    ok(issuePatch(issue, "DONE"), pm);

    assertThat(allStates(issue, bot)).containsExactly("CANCELED");
    assertThat(events.stream(WorkflowRunEnded.class)).isEmpty();
    assertThat(dsl.fetchCount(WORKFLOW_RUN, WORKFLOW_RUN.ISSUE_ID.eq(issue))).isZero();
  }

  // ───────────────────────── 코드 리뷰 지적 ─────────────────────────

  @Test
  @DisplayName("노드 담당 AI 의 상태 없는(진행만 알리는) 보고는 500 이 아니라 지금처럼 받아지고 노드·실행을 그대로 둔다(코드 리뷰 I1)")
  void reportProgressOnly_byNodeAgent_keepsNodeActive() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);
    reportOk(issue, bot, "WORKING", "하는 중", null);

    reportOk(issue, bot, null, "절반쯤 했습니다", null);

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isZero();
  }

  @Test
  @DisplayName(
      "멈춘 노드에서 노드 담당 AI 의 완료·취소·반려 보고는 USE_MOVE 가 아니라 409 WORKFLOW_NODE_SUSPENDED(조치 먼저)이고 아무것도 바뀌지 않는다")
  void reportTerminal_onSuspendedNode_pointsToRecovery() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot);
    reportOk(issue, bot, "BLOCKED", "막혔습니다", null);

    for (String state : List.of("COMPLETED", "CANCELED", "REJECTED", "REVIEW")) {
      JsonNode body = report(issue, bot, state, "끝났습니다", null, 409);

      assertThat(body.get("errors").get("code").asString())
          .as(state)
          .isEqualTo("WORKFLOW_NODE_SUSPENDED");
      assertThat(activeStates(issue, bot)).as(state).containsExactly("BLOCKED");
      assertThat(runStatus(issue)).as(state).isEqualTo("SUSPENDED");
      assertThat(runRevision(issue)).as(state).isEqualTo(1);
    }
  }

  @Test
  @DisplayName("내부 AI 의 질문 왕복 — 답으로 노드에 돌아오면 답변 필요 행이 SUBMITTED 로 돌아가 뒤의 챗 답이 다시 깨우지 않는다(코드 리뷰 I3)")
  void internalAgent_askRoundTrip_resetsInputRequired() {
    long bot = agent("INTERNAL");
    long wf = publish(yaml(bot, agent("INTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    serverRun(bot, issue, "STARTED", true, null);
    long rowId = activeRowId(issue, bot);
    ok(move(issue, "work", "ask", "어느 쪽으로 할까요?", 0, "k1"), pm);
    assertThat(activeStates(issue, bot)).containsExactly("INPUT_REQUIRED");

    ok(move(issue, "work_ask", "answered", "A 로 해 주세요", 1, "k2"), pm);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeRowId(issue, bot)).isEqualTo(rowId);
    events.clear();
    publisher.publishEvent(new IssueHumanReplyPosted(issue, lead, List.of()));
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(events.stream(AgentsResumedByChatReply.class)).isEmpty();
  }

  @Test
  @DisplayName(
      "내부 AI 실행이 실패로 끝나면 노드 BLOCKED·실행 SUSPENDED·NODE_BLOCKED 이고, 다시 시도하면 실행이 이어지고 그 AI 를 다시 깨운다(코드 리뷰 I2)")
  void serverRunFailed_byNodeAgent_suspendsRun_thenRetryWorks() {
    long bot = agent("INTERNAL");
    long wf = publish(yaml(bot, agent("INTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    serverRun(bot, issue, "STARTED", true, null);

    serverRun(bot, issue, "FINISHED", false, "빌드가 깨졌습니다");

    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runRevision(issue)).isEqualTo(1);
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("BLOCKED");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.ERROR)).isEqualTo("빌드가 깨졌습니다");
    assertThat(runEvents(issue)).contains("NODE_BLOCKED");
    assertThat(activeStates(issue, bot)).containsExactly("BLOCKED");
    events.clear();

    ok(
        post(API + "/issues/" + issue + "/workflow/recover")
            .content(json("action", "RETRY", "expectedRevision", 1)),
        lead);

    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    // 내부 AI 도 다시 들어가면 남은 차단을 풀어 「차단됨」에 갇히지 않는다.
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
  }

  @Test
  @DisplayName(
      "노드 담당 내부 AI 의 마지막 도는 실행이 이동 없이 정상으로 끝나면 노드를 멈추지 않고 작업만 대기 중(WAITING)+이유 note 로 둔다(재반려 G2)")
  void serverRunFinishedWithoutMove_marksWaitingWithNote() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String run = newRun();
    serverRun(bot, issue, "STARTED", true, null, run);
    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    events.clear();

    serverRun(bot, issue, "FINISHED", true, null, run);

    // 이 실행이 그 AI 의 마지막 도는 실행이라 「일했고 쉬는 중」 — 시작 전(SUBMITTED)이 아니다.
    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
    assertThat(allStates(issue, bot)).doesNotContain("REVIEW");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isZero();
    assertThat(runEvents(issue)).doesNotContain("NODE_BLOCKED");
    // WAITING 은 알릴 상태(ON_ENTER)가 아니라 AI 작업 알림 이벤트가 없다.
    assertThat(events.stream(AgentWorkNoticeEvent.class)).isEmpty();
    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName("진행 중 행이 없으면 마지막 도는 실행의 이동 없는 정상 끝이라도 행을 새로 열지 않는다 — 실행 뒤에 행이 닫혔다")
  void serverRunFinishedWithoutMove_noRow_untouched() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String run = newRun();
    serverRun(bot, issue, "STARTED", true, null, run);
    // 실행 중 행이 다른 길로 닫힌 경우를 흉내 낸다.
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.STATE, "COMPLETED")
        .set(AGENT_WORK.ENDED_AT, OffsetDateTime.now())
        .where(AGENT_WORK.ID.eq(activeRowId(issue, bot)))
        .execute();
    events.clear();

    serverRun(bot, issue, "FINISHED", true, null, run);

    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(events.stream(AgentWorkNoticeEvent.class)).isEmpty();
  }

  @Test
  @DisplayName(
      "실행 A 가 스스로 같은 AI 의 다음 노드로 넘긴 뒤 A 가 정상으로 끝나면(마지막 도는 실행) 새 방문에 「이동 없이 끝남」 행을 열지 않는다(우려 1)")
  void serverRunSelfMoveThenFinish_doesNotMarkNewVisit() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runA = newRun();
    serverRun(bot, issue, "STARTED", true, null, runA);
    runService.move(issue, new MoveRequest("work", "again", null, null, null, 0, "k-self"), bot);
    TenantContext.set(1L);
    // 떠난 행은 COMPLETED, 내부 AI 의 새 방문(work2)에는 행이 없다(깨우기만).
    assertThat(activeStates(issue, bot)).isEmpty();

    serverRun(bot, issue, "FINISHED", true, null, runA);

    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
    assertThat(nodeRun(issue, "work2").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName(
      "실행 A 가 도는 사이 노드 재진입으로 행이 SUBMITTED 가 되면, A 의 정상 끝(마지막 도는 실행)은 행을 SUBMITTED·note 없음 그대로 둔다(우려 1)")
  void serverRunFinish_afterReentrySubmitted_keepsSubmitted() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runA = newRun();
    serverRun(bot, issue, "STARTED", true, null, runA);
    ok(move(issue, "work", "ask", "어느 쪽으로 할까요?", 0, "k1"), pm);
    ok(move(issue, "work_ask", "answered", "A 로 해 주세요", 1, "k2"), pm);
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");

    serverRun(bot, issue, "FINISHED", true, null, runA);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeNote(issue, bot)).isNull();
    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName("새 노드의 실행 B 가 도는 중 옛 실행 A 의 정상 끝은 작업 중 그대로이고, 이슈 완료 때 COMPLETED 로 닫히며 실행 기록도 지운다")
  void serverRunOldFinish_afterNextNodeStarted_keepsWorking() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runA = newRun();
    String runB = newRun();
    serverRun(bot, issue, "STARTED", true, null, runA);
    ok(move(issue, "work", "again", null, 0, "k1"), pm);
    serverRun(bot, issue, "STARTED", true, null, runB);
    assertThat(activeStates(issue, bot)).containsExactly("WORKING");

    serverRun(bot, issue, "FINISHED", true, null, runA);

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    assertThat(activeNote(issue, bot)).isNotEqualTo("이동 없이 실행이 끝났습니다");
    assertThat(nodeRun(issue, "work2").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(serverRunRows(issue, bot)).isEqualTo(1);

    ok(issuePatch(issue, "DONE"), pm);

    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED", "COMPLETED");
    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName(
      "노드 실행 N 이 도는 중 챗 답 실행 C 가 먼저 끝나면 작업 중 그대로이고, 이어 N 이 끝나면 대기 중+이유 note, 새 실행이 시작하면 다시 작업 중(재반려 1b)")
  void serverRunChatFinish_whileNodeRunRunning_keepsWorking() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runN = newRun();
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN);
    serverRun(bot, issue, "STARTED", true, null, runC);

    serverRun(bot, issue, "FINISHED", true, null, runC);

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");

    serverRun(bot, issue, "FINISHED", true, null, runN);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
    long rowId = activeRowId(issue, bot);

    serverRun(bot, issue, "STARTED", true, null, newRun());

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    assertThat(activeRowId(issue, bot)).isEqualTo(rowId);
  }

  @Test
  @DisplayName("이동 없는 끝으로 대기 중이 된 뒤 이슈를 완료하면 그 작업은 CANCELED 가 아니라 COMPLETED 로 닫힌다(재반려 2)")
  void serverRunFinishedWithoutMove_thenIssueDone_completes() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    runToFinish(bot, issue);
    assertThat(activeStates(issue, bot)).containsExactly("WAITING");

    ok(issuePatch(issue, "DONE"), pm);

    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
  }

  @Test
  @DisplayName("실행 id 없는 정상 끝(옛 ai-agent)은 어느 실행인지 몰라 작업 중 그대로이고, 이슈 완료 때 COMPLETED 로 닫힌다")
  void serverRunFinished_withoutRunId_keepsWorking() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    serverRun(bot, issue, "STARTED", true, null);

    serverRun(bot, issue, "FINISHED", true, null);

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    assertThat(allStates(issue, bot)).doesNotContain("REVIEW");

    ok(issuePatch(issue, "DONE"), pm);

    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
  }

  @Test
  @DisplayName("다른 실행 B 가 살아 있으면 모르는 실행 id 의 정상 끝(늦게 온 옛 실행 등)은 작업 중 그대로다 — 형식이 틀린 id 도 같다")
  void serverRunFinished_unknownRunId_whileOtherRunLive_keepsWorking() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runB = newRun();
    serverRun(bot, issue, "STARTED", true, null, runB);

    serverRun(bot, issue, "FINISHED", true, null, newRun());
    serverRun(bot, issue, "FINISHED", true, null, "not-a-uuid");

    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    assertThat(serverRunRows(issue, bot)).isEqualTo(1);
  }

  @Test
  @DisplayName("STARTED 보고를 잃어 표에 없는 실행 id 라도 남은 도는 실행이 없고 행이 작업 중이면 정상 끝이 대기 중으로 내린다(코드 리뷰 2)")
  void serverRunFinished_lostStarted_noOtherRun_marksWaiting() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    // 실행 id 없이 작업 중 행만 만든다 — 그 실행의 STARTED 기록이 표에 없는 상황.
    serverRun(bot, issue, "STARTED", true, null);
    assertThat(serverRunRows(issue, bot)).isZero();

    serverRun(bot, issue, "FINISHED", true, null, newRun());

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
  }

  @Test
  @DisplayName("도는 중 담당에서 빠진 AI 의 실행 기록은 지워져, 다시 지정된 뒤 새 실행의 이동 없는 끝이 대기 중으로 내려간다(코드 리뷰 1)")
  void serverRun_unassignedMidRun_thenReassigned_newRunMarksWaiting() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runA = newRun();
    serverRun(bot, issue, "STARTED", true, null, runA);
    ok(assign(issue, null, lead), pm);
    assertThat(serverRunRows(issue, bot)).isZero();
    // 담당이 아니라 이른 return — 그래도 표에서는 지운다(이미 비어 있다).
    serverRun(bot, issue, "FINISHED", true, null, runA);
    ok(assign(issue, null, lead, bot), pm);
    String runB = newRun();
    serverRun(bot, issue, "STARTED", true, null, runB);
    assertThat(activeStates(issue, bot)).containsExactly("WORKING");

    serverRun(bot, issue, "FINISHED", true, null, runB);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName("끝 보고가 이른 return(담당 아님)에 걸려도 그 실행의 도는 실행 행은 지운다(코드 리뷰 1)")
  void serverRunFinished_earlyReturn_stillDeletesRun() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runA = newRun();
    serverRun(bot, issue, "STARTED", true, null, runA);
    // 담당 해제 정리를 거치지 않고 담당 행만 빼 이른 return 을 일으킨다.
    dsl.deleteFrom(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issue))
        .and(ISSUE_ASSIGNEE.USER_ID.eq(bot))
        .execute();
    assertThat(serverRunRows(issue, bot)).isEqualTo(1);

    serverRun(bot, issue, "FINISHED", true, null, runA);

    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName("새 실행의 STARTED 는 그 이슈·AI 의 오래된(FINISHED 없이 죽은) 실행 행을 함께 지운다(코드 리뷰 5)")
  void serverRunStarted_purgesStaleRows() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    UUID stale = UUID.randomUUID();
    insertRun(issue, bot, stale, 1, null);
    String run = newRun();

    serverRun(bot, issue, "STARTED", true, null, run);

    assertThat(serverRunRows(issue, bot)).isEqualTo(1);
    assertThat(dsl.fetchExists(AGENT_SERVER_RUN, AGENT_SERVER_RUN.RUN_ID.eq(UUID.fromString(run))))
        .isTrue();
  }

  @Test
  @DisplayName("FINISHED 없이 오래 남은(실행 제한 시간을 넉넉히 넘긴) 도는 실행 행은 세지 않아, 마지막 실행의 끝이 대기 중으로 내린다")
  void serverRunFinished_staleRunIgnored() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String run = newRun();
    serverRun(bot, issue, "STARTED", true, null, run);
    insertRun(issue, bot, UUID.randomUUID(), 1, null);

    serverRun(bot, issue, "FINISHED", true, null, run);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
  }

  @Test
  @DisplayName(
      "FINISHED 뒤 늦게 온 같은 실행의 STARTED 는 도는 실행을 만들지 않고 대기 중을 덮지 않으며, 다음 실행의 끝은 다시 대기 중으로 내린다")
  void serverRunLateStarted_afterFinished_ignored() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    // 실행 id 없이 작업 중 행만 만든다 — 실행 R 의 STARTED 가 아직 반영되지 않은 상황.
    serverRun(bot, issue, "STARTED", true, null);
    String runR = newRun();
    serverRun(bot, issue, "FINISHED", true, null, runR);
    assertThat(activeStates(issue, bot)).containsExactly("WAITING");

    serverRun(bot, issue, "STARTED", true, null, runR);

    assertThat(serverRunRows(issue, bot)).isZero();
    assertThat(runRowExists(UUID.fromString(runR))).isTrue();
    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");

    String runS = newRun();
    serverRun(bot, issue, "STARTED", true, null, runS);
    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    serverRun(bot, issue, "FINISHED", true, null, runS);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName(
      "노드 실행 N 이 도는 중 댓글 실행 C 가 실패로 끝나면 노드·실행·작업이 그대로이고, 이어 N 이 실패로 끝나면 지금처럼 노드 BLOCKED·실행 SUSPENDED 다")
  void serverRunFailed_whileOtherRunLive_keepsNode() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runN = newRun();
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN);
    serverRun(bot, issue, "STARTED", true, null, runC);

    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runC);

    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isZero();
    assertThat(runEvents(issue)).doesNotContain("NODE_BLOCKED");
    assertThat(activeStates(issue, bot)).containsExactly("WORKING");
    assertThat(serverRunRows(issue, bot)).isEqualTo(1);

    serverRun(bot, issue, "FINISHED", false, "빌드가 깨졌습니다", runN);

    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("BLOCKED");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.ERROR)).isEqualTo("빌드가 깨졌습니다");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runEvents(issue)).contains("NODE_BLOCKED");
    assertThat(activeStates(issue, bot)).containsExactly("BLOCKED");
  }

  @Test
  @DisplayName(
      "노드 실행 N 이 실패로 끝났지만 댓글 실행 C 가 돌아 미뤘으면, C 가 정상으로 끝날 때 대기 중 대신 N 의 실패로 노드 BLOCKED·실행 SUSPENDED 다")
  void serverRunDeferredFailure_appliedWhenLastRunSucceeds() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runN = newRun();
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN);
    serverRun(bot, issue, "STARTED", true, null, runC);
    serverRun(bot, issue, "FINISHED", false, "빌드가 깨졌습니다", runN);
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(activeStates(issue, bot)).containsExactly("WORKING");

    serverRun(bot, issue, "FINISHED", true, null, runC);

    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("BLOCKED");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.ERROR)).isEqualTo("빌드가 깨졌습니다");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runEvents(issue)).contains("NODE_BLOCKED");
    assertThat(activeStates(issue, bot)).containsExactly("BLOCKED");
    assertThat(activeNote(issue, bot)).isEqualTo("빌드가 깨졌습니다");
    // 처리한 사유는 비워 두 번 쓰지 않는다.
    assertThat(hasFailedNote(issue)).isFalse();
  }

  @Test
  @DisplayName("앞 노드에서 미룬 실패는 같은 AI 가 다음 노드로 넘어간 뒤 새 노드 실행의 이동 없는 끝에 끼지 않는다")
  void serverRunDeferredFailure_notAppliedAfterNodeChange() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runN1 = newRun();
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN1);
    serverRun(bot, issue, "STARTED", true, null, runC);
    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runC);
    ok(move(issue, "work", "again", null, 0, "k1"), pm);
    String runN2 = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN2);
    serverRun(bot, issue, "FINISHED", true, null, runN1);

    serverRun(bot, issue, "FINISHED", true, null, runN2);

    assertThat(nodeRun(issue, "work2").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
  }

  @Test
  @DisplayName("노드 담당이 아닌(손으로 넣은) AI 의 실패 끝은 다른 실행이 돌아도 미루지 않고 바로 차단됨이며 노드는 그대로다")
  void serverRunFailed_notNodeAssignee_blocksImmediately() {
    long bot = agent("INTERNAL");
    long other = agent("INTERNAL");
    long wf = publish(yaml(bot, agent("INTERNAL")));
    long issue = issue(lead, other);
    ok(startReq(issue, wf), pm);
    String runX = newRun();
    serverRun(other, issue, "STARTED", true, null, runX);
    serverRun(other, issue, "STARTED", true, null, newRun());

    serverRun(other, issue, "FINISHED", false, "실패했습니다", runX);

    assertThat(activeStates(issue, other)).containsExactly("BLOCKED");
    assertThat(activeNote(issue, other)).isEqualTo("실패했습니다");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(hasFailedNote(issue)).isFalse();
  }

  @Test
  @DisplayName(
      "앞 노드(work)에서 시작한 실행의 실패 끝은 같은 AI 가 맡은 다음 노드(work2) 방문에 미뤄지지 않아, work2 실행이 모두 정상으로 끝나면 대기 중이다")
  void failureFromRunStartedOnPreviousNode_notDeferred() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runN1 = newRun();
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN1);
    serverRun(bot, issue, "STARTED", true, null, runC);
    ok(move(issue, "work", "again", null, 0, "k1"), pm);
    String runN2 = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN2);

    // C 는 work 방문에서 시작했다 — 지금 방문(work2)과 상관없는 실행이라 미루지도 멈추지도 않는다.
    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runC);

    assertThat(hasFailedNote(issue)).isFalse();
    assertThat(nodeRun(issue, "work2").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");

    serverRun(bot, issue, "FINISHED", true, null, runN1);
    serverRun(bot, issue, "FINISHED", true, null, runN2);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
    assertThat(runEvents(issue)).doesNotContain("NODE_BLOCKED");
  }

  @Test
  @DisplayName("앞 노드(work)에서 시작한 실행이 다음 노드(work2)로 옮긴 뒤 마지막 실행으로 실패해도 work2 를 멈추지 않는다")
  void lastFailureFromPreviousNodeRun_doesNotBlockNewNode() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runC);
    ok(move(issue, "work", "again", null, 0, "k1"), pm);

    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runC);

    assertThat(nodeRun(issue, "work2").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runEvents(issue)).doesNotContain("NODE_BLOCKED");
    assertThat(activeStates(issue, bot)).doesNotContain("BLOCKED");
    assertThat(hasFailedNote(issue)).isFalse();
  }

  @Test
  @DisplayName("앞 노드에서 시작한 실행이 마지막으로 실패해 끝나면 지금 방문에서 미룬 실패를 따라 work2 를 멈춘다")
  void lastFailureFromPreviousNodeRun_appliesCurrentVisitDeferredFailure() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runC);
    ok(move(issue, "work", "again", null, 0, "k1"), pm);
    String runN2 = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN2);
    // N2 는 지금 방문의 실행 — C 가 아직 돌아 사유가 미뤄진다.
    serverRun(bot, issue, "FINISHED", false, "빌드가 깨졌습니다", runN2);
    assertThat(hasFailedNote(issue)).isTrue();

    // C(앞 방문)가 마지막으로 실패 — C 의 사유는 쓰지 않고 지금 방문의 미룬 사유로 멈춘다.
    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runC);

    assertThat(activeStates(issue, bot)).containsExactly("BLOCKED");
    assertThat(activeNote(issue, bot)).isEqualTo("빌드가 깨졌습니다");
    assertThat(nodeRun(issue, "work2").get(NODE_RUN.STATUS)).isEqualTo("BLOCKED");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(hasFailedNote(issue)).isFalse();
  }

  @Test
  @DisplayName("앞 노드에서 시작한 실행이 마지막으로 실패해 끝나고 지금 방문 실행은 정상으로 끝났으면 대기 중으로 내린다")
  void lastFailureFromPreviousNodeRun_afterCurrentVisitSuccess_waits() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runC);
    ok(move(issue, "work", "again", null, 0, "k1"), pm);
    String runN2 = newRun();
    serverRun(bot, issue, "STARTED", true, null, runN2);
    serverRun(bot, issue, "FINISHED", true, null, runN2);
    assertThat(activeStates(issue, bot)).containsExactly("WORKING");

    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runC);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
    assertThat(nodeRun(issue, "work2").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runEvents(issue)).doesNotContain("NODE_BLOCKED");
  }

  @Test
  @DisplayName("멈춘 방문에서 미룬 실패는 다시 시도(새 방문) 뒤 새 방문의 마지막 실행 끝에 따르지 않아 다시 멈추지 않는다")
  void failureDeferredBeforeRetry_notAppliedToRetriedVisit() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runX = newRun();
    serverRun(bot, issue, "STARTED", true, null, runX);
    serverRun(bot, issue, "FINISHED", false, "빌드가 깨졌습니다", runX);
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    // 멈춘 방문에서 B·C 가 돌고 B 가 실패 — C 가 돌아 미뤄진다.
    String runB = newRun();
    String runC = newRun();
    serverRun(bot, issue, "STARTED", true, null, runB);
    serverRun(bot, issue, "STARTED", true, null, runC);
    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runB);
    assertThat(hasFailedNote(issue)).isTrue();

    ok(
        post(API + "/issues/" + issue + "/workflow/recover")
            .content(json("action", "RETRY", "expectedRevision", 1)),
        lead);
    String runD = newRun();
    serverRun(bot, issue, "STARTED", true, null, runD);
    serverRun(bot, issue, "FINISHED", true, null, runC);

    serverRun(bot, issue, "FINISHED", true, null, runD);

    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(activeNote(issue, bot)).isEqualTo("이동 없이 실행이 끝났습니다");
    // 앞 방문의 사유는 꺼낼 때 함께 비워 남지 않는다.
    assertThat(hasFailedNote(issue)).isFalse();
  }

  @Test
  @DisplayName("같은 방문에서 미룬 실패는 AI 가 대기 중을 보고한 뒤 다른 실행이 아직 돌 때의 정상 끝(OWNED)에 지워지지 않는다")
  void ownedEndWhileOtherRunLive_keepsSameVisitFailure() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runB = newRun();
    String runC = newRun();
    String runA = newRun();
    serverRun(bot, issue, "STARTED", true, null, runB);
    serverRun(bot, issue, "STARTED", true, null, runC);
    serverRun(bot, issue, "STARTED", true, null, runA);
    serverRun(bot, issue, "FINISHED", false, "답을 쓰지 못했습니다", runB);
    reportOk(issue, bot, "WAITING", "CI 를 기다립니다", null);

    serverRun(bot, issue, "FINISHED", true, null, runA);

    assertThat(hasFailedNote(issue)).isTrue();
  }

  @Test
  @DisplayName("실행 id 없는 실패 끝은 다른 도는 실행이 있어도 어느 실행인지 몰라 지금처럼 노드를 멈춘다")
  void serverRunFailed_withoutRunId_whileOtherRunLive_stillBlocks() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    serverRun(bot, issue, "STARTED", true, null, newRun());

    serverRun(bot, issue, "FINISHED", false, "빌드가 깨졌습니다");

    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("BLOCKED");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runEvents(issue)).contains("NODE_BLOCKED");
    assertThat(activeStates(issue, bot)).containsExactly("BLOCKED");
  }

  @Test
  @DisplayName(
      "끝난 실행 행은 끝난 지 RUN_STALE_AFTER 가 지나면 새 STARTED 때 정리되고, 그 안의 끝난 행은 늦은 STARTED 를 막으려고 남는다")
  void serverRunStarted_purgesOldFinishedRows() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    UUID old = UUID.randomUUID();
    UUID recent = UUID.randomUUID();
    // 오래전에 끝난 행과, 오래전에 시작했지만 방금 끝난 행(정리 기준은 끝난 시각이다).
    insertRun(issue, bot, old, 2, 1);
    insertRun(issue, bot, recent, 1, 0);

    serverRun(bot, issue, "STARTED", true, null, newRun());

    assertThat(runRowExists(old)).isFalse();
    assertThat(runRowExists(recent)).isTrue();
    assertThat(serverRunRows(issue, bot)).isEqualTo(1);
  }

  @Test
  @DisplayName("끝 보고도 그 이슈·AI 의 끝난 지 RUN_STALE_AFTER 가 지난 행을 지운다 — 담당 아님 경로로 묘비가 쌓이지 않게")
  void serverRunFinished_purgesOldFinishedRows() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    UUID old = UUID.randomUUID();
    insertRun(issue, bot, old, 2, 1);
    dsl.deleteFrom(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issue))
        .and(ISSUE_ASSIGNEE.USER_ID.eq(bot))
        .execute();
    String run = newRun();

    serverRun(bot, issue, "FINISHED", true, null, run);

    assertThat(runRowExists(old)).isFalse();
    assertThat(runRowExists(UUID.fromString(run))).isTrue();
  }

  @Test
  @DisplayName("끝난 실행은 담당 해제·재지정 뒤에도 기억돼, 그 실행의 늦은 STARTED 가 도는 실행을 만들지 않는다")
  void serverRunLateStarted_afterUnassignReassign_ignored() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    String runA = newRun();
    serverRun(bot, issue, "STARTED", true, null, runA);
    serverRun(bot, issue, "FINISHED", true, null, runA);
    ok(assign(issue, null, lead), pm);
    ok(assign(issue, null, lead, bot), pm);

    serverRun(bot, issue, "STARTED", true, null, runA);

    assertThat(serverRunRows(issue, bot)).isZero();
    assertThat(runRowExists(UUID.fromString(runA))).isTrue();
  }

  @Test
  @DisplayName("같은 실행의 STARTED 재시도는 오래된 행 정리에 그 실행의 행을 지웠다 다시 넣지 않는다(시작 시각이 그대로)")
  void serverRunStarted_retryKeepsOwnRow() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    UUID run = UUID.randomUUID();
    insertRun(issue, bot, run, 1, null);

    serverRun(bot, issue, "STARTED", true, null, run.toString());

    // 지웠다 다시 넣었다면 시작 시각이 지금(now())이 됐을 것이다.
    assertThat(
            dsl.fetchExists(
                AGENT_SERVER_RUN,
                AGENT_SERVER_RUN
                    .RUN_ID
                    .eq(run)
                    .and(AGENT_SERVER_RUN.STARTED_AT.lt(DSL.currentOffsetDateTime()))))
        .isTrue();
  }

  @Test
  @DisplayName("이동 없는 끝(대기 중) 뒤 질문 왕복으로 노드에 다시 들어오면 그 note 가 질문처럼 남지 않고 SUBMITTED·note 없음이 된다")
  void finishedWithoutMove_thenReenter_resetsToSubmitted() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    runToFinish(bot, issue);
    long rowId = activeRowId(issue, bot);

    ok(move(issue, "work", "ask", "어느 쪽으로 할까요?", 0, "k1"), pm);

    assertThat(activeStates(issue, bot)).containsExactly("INPUT_REQUIRED");
    assertThat(activeNote(issue, bot)).isNull();

    ok(move(issue, "work_ask", "answered", "A 로 해 주세요", 1, "k2"), pm);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeNote(issue, bot)).isNull();
    assertThat(activeRowId(issue, bot)).isEqualTo(rowId);
  }

  @Test
  @DisplayName("이동 없는 끝(대기 중) 뒤 멈춘 노드를 다시 시도(RETRY)하면 SUBMITTED·note 없음이 되고 그 AI 를 다시 깨운다")
  void finishedWithoutMove_thenRetry_resetsToSubmitted() {
    long bot = agent("INTERNAL");
    long issue = internalStartedIssue(bot);
    runToFinish(bot, issue);
    // 쉬는 행을 그대로 둔 채 실행만 멈춘다 — 실패 끝은 행을 차단됨으로 덮으므로 실행·방문을 직접 멈춘다.
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "SUSPENDED")
        .set(WORKFLOW_RUN.REVISION, 1)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .execute();
    dsl.update(NODE_RUN)
        .set(NODE_RUN.STATUS, "BLOCKED")
        .set(NODE_RUN.WAITING_REASON, "BLOCKED")
        .where(NODE_RUN.NODE_KEY.eq("work"))
        .and(NODE_RUN.LEFT_AT.isNull())
        .and(
            NODE_RUN.RUN_ID.in(
                DSL.select(WORKFLOW_RUN.ID)
                    .from(WORKFLOW_RUN)
                    .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))))
        .execute();
    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    events.clear();

    ok(
        post(API + "/issues/" + issue + "/workflow/recover")
            .content(json("action", "RETRY", "expectedRevision", 1)),
        lead);

    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeNote(issue, bot)).isNull();
    assertThat(wakes()).hasSize(1);
  }

  @Test
  @DisplayName("노드 담당 내부 AI 의 행이 기다림(WAITING)이면 이동 없는 정상 끝 보고가 행·노드·실행을 건드리지 않는다")
  void serverRunFinishedWithoutMove_waitingRowUntouched() {
    long bot = agent("INTERNAL");
    long wf = publish(yaml(bot, agent("INTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    serverRun(bot, issue, "STARTED", true, null);
    // 내부 AI 는 기다림을 보고할 REST 길이 없어 행을 직접 기다림으로 둔다.
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.STATE, "WAITING")
        .where(AGENT_WORK.ID.eq(activeRowId(issue, bot)))
        .execute();

    serverRun(bot, issue, "FINISHED", true, null);

    assertThat(activeStates(issue, bot)).containsExactly("WAITING");
    assertThat(allStates(issue, bot)).doesNotContain("REVIEW");
    assertThat(nodeRun(issue, "work").get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isZero();
  }

  @Test
  @DisplayName("워크플로우가 없는 이슈의 내부 AI 정상 끝 보고는 지금처럼 검토 대기를 쓴다")
  void serverRunFinished_noWorkflow_unchanged() {
    long bot = agent("INTERNAL");
    long issue = issue(lead, bot);
    serverRun(bot, issue, "STARTED", true, null);

    serverRun(bot, issue, "FINISHED", true, null);

    assertThat(activeStates(issue, bot)).containsExactly("REVIEW");
  }

  @Test
  @DisplayName("워크플로우가 없는 이슈의 내부 AI 정상 끝 보고는 실행 id 가 있어도 지금처럼 검토 대기를 쓴다")
  void serverRunFinished_noWorkflow_withRunId_unchanged() {
    long bot = agent("INTERNAL");
    long issue = issue(lead, bot);
    String run = newRun();
    serverRun(bot, issue, "STARTED", true, null, run);

    serverRun(bot, issue, "FINISHED", true, null, run);

    assertThat(activeStates(issue, bot)).containsExactly("REVIEW");
    assertThat(serverRunRows(issue, bot)).isZero();
  }

  @Test
  @DisplayName("노드를 이미 떠난 내부 AI 의 정상 끝 보고는 떠날 때 COMPLETED 로 닫힌 작업을 검토 대기로 되살리지 않는다(코드 리뷰 I2)")
  void serverRunSucceeded_afterLeavingNode_keepsCompleted() {
    long bot = agent("INTERNAL");
    long wf = publish(yaml(bot, agent("INTERNAL")));
    // bot 을 손으로 넣어 두면 노드를 떠나도 이슈 담당에 남는다 — 실행 끝 보고가 담당 확인을 지나 판정까지 온다.
    long issue = issue(lead, bot);
    ok(startReq(issue, wf), pm);
    serverRun(bot, issue, "STARTED", true, null);
    ok(move(issue, "work", "done", null, 0, "k1"), pm);
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");

    serverRun(bot, issue, "FINISHED", true, null);

    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
    assertThat(activeStates(issue, bot)).isEmpty();
  }

  @Test
  @DisplayName("켠 프로젝트라도 어떤 정의도 시작할 수 없는(시작 역할이 담당에 없는) 이슈의 AI 담당 지정은 지금처럼 깨운다(코드 리뷰 I4)")
  void enabledProject_assignOutsideStartScope_stillWakes() {
    long bot = agent("EXTERNAL");
    publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue();
    events.clear();

    ok(assign(issue, null, bot), pm);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    List<IssueAssignedEvent> assigned = events.stream(IssueAssignedEvent.class).toList();
    assertThat(assigned).hasSize(1);
    assertThat(assigned.getFirst().wakeAgent()).isTrue();
  }

  /** 서버 실행기(ai-agent)의 실행 보고 — 내부 AI 의 시작·끝을 서비스로 직접 알린다(같은 시험 트랜잭션). */
  private void serverRun(long agentId, long issue, String phase, boolean ok, String note) {
    serverRun(agentId, issue, phase, ok, note, null);
  }

  /** 실행 id 를 실은 실행 보고(WP-1986 — 지금 ai-agent 의 모양). */
  private void serverRun(
      long agentId, long issue, String phase, boolean ok, String note, String runId) {
    serverAgentRunService.report(agentId, issue, new ServerAgentRunReport(phase, ok, note, runId));
    TenantContext.set(1L);
  }

  /** 실행 id 하나(ai-agent 가 실행마다 만드는 UUID 문자열). */
  private static String newRun() {
    return UUID.randomUUID().toString();
  }

  /** 새 실행 하나를 시작하고 정상으로 끝낸다(STARTED → FINISHED ok, 같은 실행 id). */
  private void runToFinish(long agentId, long issue) {
    String run = newRun();
    serverRun(agentId, issue, "STARTED", true, null, run);
    serverRun(agentId, issue, "FINISHED", true, null, run);
  }

  /** 내부 AI bot 이 맡는 work(agent_task)에 머물게 시작한 이슈 id(lead 담당). */
  private long internalStartedIssue(long bot) {
    long wf = publish(yaml(bot, agent("INTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    return issue;
  }

  /** (이슈, AI) 의 남은 도는(끝남 표시가 없는) 서버 실행 행 수. */
  private int serverRunRows(long issue, long agentId) {
    return dsl.fetchCount(
        AGENT_SERVER_RUN,
        AGENT_SERVER_RUN
            .ISSUE_ID
            .eq(issue)
            .and(AGENT_SERVER_RUN.AGENT_ID.eq(agentId))
            .and(AGENT_SERVER_RUN.FINISHED_AT.isNull()));
  }

  /**
   * 실행 행을 시각을 정해 직접 넣는다(시험 트랜잭션은 now() 가 멈춰 있다) — {@code finishedHoursAgo} 가 null 이면 도는 행(FINISHED
   * 없이 죽은 실행 등), 있으면 끝난 행.
   */
  private void insertRun(
      long issue, long agentId, UUID runId, int startedHoursAgo, Integer finishedHoursAgo) {
    var insert =
        dsl.insertInto(AGENT_SERVER_RUN)
            .set(AGENT_SERVER_RUN.TENANT_ID, 1L)
            .set(AGENT_SERVER_RUN.ISSUE_ID, issue)
            .set(AGENT_SERVER_RUN.AGENT_ID, agentId)
            .set(AGENT_SERVER_RUN.RUN_ID, runId)
            .set(AGENT_SERVER_RUN.STARTED_AT, hoursAgo(startedHoursAgo));
    if (finishedHoursAgo != null) {
      insert = insert.set(AGENT_SERVER_RUN.FINISHED_AT, hoursAgo(finishedHoursAgo));
    }
    insert.execute();
  }

  /** DB now() 로부터 몇 시간 전 시각. */
  private static Field<OffsetDateTime> hoursAgo(int hours) {
    return DSL.field("now() - make_interval(hours => {0})", OffsetDateTime.class, hours);
  }

  /** 이 이슈에 미룬 실패 사유가 남아 있는지 — 다른 시험의 행과 섞이지 않게 이슈로 좁힌다. */
  private boolean hasFailedNote(long issue) {
    return dsl.fetchExists(
        AGENT_SERVER_RUN,
        AGENT_SERVER_RUN.ISSUE_ID.eq(issue).and(AGENT_SERVER_RUN.FAILED_NOTE.isNotNull()));
  }

  /** 실행 id 의 행이 표에 남아 있는지(끝난 행 포함). */
  private boolean runRowExists(UUID runId) {
    return dsl.fetchExists(AGENT_SERVER_RUN, AGENT_SERVER_RUN.RUN_ID.eq(runId));
  }

  // ───────────────────────── 도우미 ─────────────────────────

  /** 담당 교체 REST — startWorkflowId 가 있으면 함께 싣는다. */
  private MockHttpServletRequestBuilder assign(long issue, Long startWorkflowId, long... userIds) {
    Map<String, Object> body = new LinkedHashMap<>();
    List<Long> ids = new ArrayList<>();
    for (long u : userIds) {
      ids.add(u);
    }
    body.put("userIds", ids);
    if (startWorkflowId != null) body.put("startWorkflowId", startWorkflowId);
    return put(API + "/projects/" + key + "/issues/" + issueNumber(issue) + "/assignees")
        .content(om.writeValueAsString(body));
  }

  /** 이슈 상태 바꾸기 REST(PATCH). */
  private MockHttpServletRequestBuilder issuePatch(long issue, String status) {
    return patch(API + "/projects/" + key + "/issues/" + issueNumber(issue))
        .content(json("status", status));
  }

  private Object runEndedAt(long issue) {
    return dsl.select(WORKFLOW_RUN.ENDED_AT)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.ENDED_AT);
  }

  /**
   * lead 가 담당이면 decision 을 지나 bot 한 명이 맡는 work 에 머무는 정의 — 시작 조건이 task 를 바로 가리키면 검증기가 역할 겹침을 요구하므로
   * decision 을 거친다. work 의 결과: done(사람 확인), ask(질문 — work_ask 의 returnTo 가 work), again(같은 AI 의
   * work2), handoff(bot2 의 work3).
   */
  private String yaml(long bot, long bot2) {
    return """
    schema: genia/workflow@1
    name: 다리
    roles:
      lead: { members: ["%s"] }
      bot: { members: ["%s"] }
      bot2: { members: ["%s"] }
    nodes:
      start: { type: start }
      route: { type: decision, default: work }
      work:
        type: agent_task
        role: bot
        instructions: 작업
        outcomes:
          done: { to: check, assignTo: lead }
          ask: { to: work_ask, assignTo: lead, requireComment: true }
          again: { to: work2, assignTo: bot }
          handoff: { to: work3, assignTo: bot2 }
      work_ask:
        type: human_task
        role: lead
        returnTo: work
        outcomes:
          answered: { to: work, assignTo: keep, requireComment: true }
      work2: { type: agent_task, role: bot, instructions: 이어서, outcomes: { done: { to: end } } }
      work3: { type: agent_task, role: bot2, instructions: 넘겨받음, outcomes: { done: { to: end } } }
      check: { type: human_task, role: lead, outcomes: { ok: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: route }
    """
        .formatted(username(lead), username(bot), username(bot2));
  }

  /**
   * lead 가 담당이면 bot 이 맡는 work 에 머물고, work 의 go 가 decision n 개를 줄지어 지나 check(lead) 로 가는 정의 — 21 이면
   * 자동 연쇄 한도(20)를 넘어 실행이 decision 에서 멈춘다(이슈 담당은 그대로).
   */
  private String chainYaml(long bot, int n) {
    StringBuilder nodes = new StringBuilder();
    for (int i = 1; i <= n; i++) {
      nodes.append("  d").append(i).append(": { type: decision, default: ");
      nodes.append(i == n ? "check" : "d" + (i + 1)).append(" }\n");
    }
    return """
    schema: genia/workflow@1
    name: 긴 연쇄
    roles:
      lead: { members: ["%s"] }
      bot: { members: ["%s"] }
    nodes:
      start: { type: start }
      route: { type: decision, default: work }
      work: { type: agent_task, role: bot, instructions: 작업, outcomes: { go: { to: d1, assignTo: lead } } }
    %s  check: { type: human_task, role: lead, outcomes: { ok: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: route }
    """
        .formatted(username(lead), username(bot), nodes);
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  /** 프로젝트 구성원 AI — runtime 은 INTERNAL|EXTERNAL(AgentWorkTestSupport.makeExternal 과 같은 방식). */
  private long agent(String runtime) {
    long id = withMembership(TestFixtures.createAgentNoToken(dsl));
    dsl.update(USER).set(USER.AGENT_RUNTIME, runtime).where(USER.ID.eq(id)).execute();
    projectMemberRepository.insert(projectId, id, "MEMBER");
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  /** 이 프로젝트에 게시하고 켠 정의 id. */
  private long publish(String yaml) {
    JsonNode created =
        expect(
            post(API + "/projects/" + projectId + "/workflows")
                .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml)),
            pm,
            201);
    long id = created.get("id").asLong();
    expect(post(API + "/workflows/" + id + "/publish"), pm, 200);
    ok(patch(API + "/workflows/" + id).content(json("enabled", true)), pm);
    return id;
  }

  /** 관리자가 담당을 넣어 만든 이슈 id. */
  private long issue(long... assignees) {
    List<Long> ids = new ArrayList<>();
    for (long a : assignees) {
      ids.add(a);
    }
    JsonNode body =
        expect(
            post(API + "/projects/" + key + "/issues")
                .content(json("title", "이슈", "assigneeIds", ids)),
            pm,
            200);
    return body.get("id").asLong();
  }

  private MockHttpServletRequestBuilder startReq(long issue, long wf) {
    return post(API + "/issues/" + issue + "/workflow/start")
        .content(json("workflowId", wf, "dryRun", false));
  }

  private MockHttpServletRequestBuilder move(
      long issue, String from, String outcome, String comment, int revision, String idemKey) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("fromNode", from);
    body.put("outcome", outcome);
    if (comment != null) body.put("comment", comment);
    body.put("expectedRevision", revision);
    body.put("idempotencyKey", idemKey);
    return post(API + "/issues/" + issue + "/workflow/move").content(om.writeValueAsString(body));
  }

  /** 그 이슈에서 그 사람이 받은 ASSIGNED 알림 수. */
  private int assignedNotifications(long issue, long recipient) {
    return dsl.fetchCount(
        NOTIFICATION,
        NOTIFICATION
            .ISSUE_ID
            .eq(issue)
            .and(NOTIFICATION.RECIPIENT_ID.eq(recipient))
            .and(NOTIFICATION.TYPE.eq("ASSIGNED")));
  }

  /** 워크플로우 노드 깨우기 이벤트. */
  private List<WorkflowNodeWakeEvent> wakes() {
    return events.stream(WorkflowNodeWakeEvent.class).toList();
  }

  /** 그 작업자의 진행 중 agent_work 상태. */
  private List<String> activeStates(long issue, long worker) {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issue))
        .and(AGENT_WORK.WORKER_ID.eq(worker))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetch(AGENT_WORK.STATE);
  }

  /** 그 작업자의 모든 agent_work 상태(id 순). */
  private List<String> allStates(long issue, long worker) {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issue))
        .and(AGENT_WORK.WORKER_ID.eq(worker))
        .orderBy(AGENT_WORK.ID)
        .fetch(AGENT_WORK.STATE);
  }

  /** 그 작업자의 진행 중 agent_work note(없으면 null). */
  private String activeNote(long issue, long worker) {
    return dsl.select(AGENT_WORK.NOTE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issue))
        .and(AGENT_WORK.WORKER_ID.eq(worker))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetchSingle(AGENT_WORK.NOTE);
  }

  private long activeRowId(long issue, long worker) {
    return dsl.select(AGENT_WORK.ID)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issue))
        .and(AGENT_WORK.WORKER_ID.eq(worker))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetchSingle(AGENT_WORK.ID);
  }

  /** lead 가 담당인 이슈에 정의를 시작해 bot 이 맡는 work(agent_task)에 머물게 한 이슈 id. */
  private long startedIssue(long bot) {
    long wf = publish(yaml(bot, agent("EXTERNAL")));
    long issue = issue(lead);
    ok(startReq(issue, wf), pm);
    return issue;
  }

  /** 실제 보고 REST(PUT agent-work) — AI 키(ak_)와 수행 도구 헤더로 보낸다. 200 을 기대한다. */
  private void reportOk(long issue, long worker, String state, String note, String message) {
    report(issue, worker, state, note, message, 200);
  }

  /**
   * 실제 보고 REST. 수행 도구 헤더(X-Agent-Tool)는 AI 키 인증 필터만 읽으므로 JWT 가 아니라 그 AI 의 ak_ 키로 보낸다 — MockMvc 도 보안
   * 필터를 지나고, 필터의 조회는 같은 스레드의 시험 트랜잭션을 본다.
   */
  private JsonNode report(
      long issue, long worker, String state, String note, String message, int status) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("state", state);
    if (note != null) body.put("note", note);
    if (message != null) body.put("message", message);
    var req =
        put(API + "/projects/" + key + "/issues/" + issueNumber(issue) + "/agent-work")
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body))
            .header("Authorization", "Bearer " + agentKey(worker))
            .header(AgentToolContext.HEADER, "claude-code");
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      assertThat(response.getStatus()).as("%s", text).isEqualTo(status);
      return text.isBlank() ? null : om.readTree(text);
    } catch (Exception e) {
      throw new IllegalStateException("보고 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }

  /** AI 키(+ 도구 맥락 헤더)로 호출한 요청이 200 인지 확인한다 — 외부 AI 가 직접 이동하는 경로. */
  private void expectAsAgent(MockHttpServletRequestBuilder req, long worker) {
    req.contentType(MediaType.APPLICATION_JSON)
        .header("Authorization", "Bearer " + agentKey(worker))
        .header(AgentToolContext.HEADER, "claude-code");
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      assertThat(response.getStatus())
          .as("%s", response.getContentAsString(StandardCharsets.UTF_8))
          .isEqualTo(200);
    } catch (Exception e) {
      throw new IllegalStateException("AI 요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }

  /** AI 의 ak_ 키 평문 — 발급자는 프로젝트 소유자. */
  private String agentKey(long worker) {
    return agentKeyService.issue(pm, worker, new IssueAgentKeyRequest("wf")).plaintextKey();
  }

  private int issueNumber(long issue) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issue)).fetchSingle(ISSUE.NUMBER);
  }

  private String issueStatus(long issue) {
    return dsl.select(ISSUE.STATUS).from(ISSUE).where(ISSUE.ID.eq(issue)).fetchSingle(ISSUE.STATUS);
  }

  /** 그 노드의 가장 최근 방문 행. */
  private org.jooq.Record nodeRun(long issue, String nodeKey) {
    return dsl.select(NODE_RUN.STATUS, NODE_RUN.WAITING_REASON, NODE_RUN.ERROR, NODE_RUN.LEFT_AT)
        .from(NODE_RUN)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(NODE_RUN.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .and(NODE_RUN.NODE_KEY.eq(nodeKey))
        .orderBy(NODE_RUN.ID.desc())
        .limit(1)
        .fetchSingle();
  }

  private int runRevision(long issue) {
    return dsl.select(WORKFLOW_RUN.REVISION)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.REVISION);
  }

  /** 실행 이벤트 type(일어난 순서). */
  private List<String> runEvents(long issue) {
    return dsl.select(WORKFLOW_RUN_EVENT.TYPE)
        .from(WORKFLOW_RUN_EVENT)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .fetch(WORKFLOW_RUN_EVENT.TYPE);
  }

  private String runStatus(long issue) {
    return dsl.select(WORKFLOW_RUN.STATUS)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.STATUS);
  }

  private List<Long> issueAssignees(long issue) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issue))
        .fetch(ISSUE_ASSIGNEE.USER_ID);
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return om.writeValueAsString(map);
  }

  private JsonNode ok(MockHttpServletRequestBuilder req, long caller) {
    return expect(req, caller, 200);
  }

  private JsonNode expect(MockHttpServletRequestBuilder req, long caller, int status) {
    req.contentType(MediaType.APPLICATION_JSON);
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      assertThat(response.getStatus()).as("%s", text).isEqualTo(status);
      return text.isBlank() ? null : om.readTree(text);
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }
}
