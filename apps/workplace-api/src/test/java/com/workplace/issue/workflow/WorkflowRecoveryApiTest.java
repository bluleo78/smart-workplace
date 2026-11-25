package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_COMMENT;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.auth.dto.IssueAgentKeyRequest;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.security.AgentToolContext;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeWakeEvent;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowRunEnded;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowVisitLimitReached;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1986 멈춘 실행의 조치 REST({@code POST /issues/{id}/workflow/recover}) — 다시 시도·onError·관리자 옮기기·취소.
 *
 * <p>멈춤은 실제 작업 보고 REST(노드 담당 AI 의 BLOCKED·FAILED)로 만든다 — 그 뒤 실행 revision 은 1 이다. 요청은 시험 트랜잭션에 합류하고
 * 롤백되므로 커밋 뒤 소비자는 돌지 않는다(깨우기는 기록된 {@link WorkflowNodeWakeEvent} 로 본다).
 */
@RecordApplicationEvents
@Transactional
class WorkflowRecoveryApiTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired ApplicationEvents events;
  @Autowired AgentApiKeyService agentKeyService;

  /** 프로젝트 OWNER(관리자). */
  private long pm;

  /** 일반 구성원(MEMBER) — 시작 조건의 역할이자 사람 노드 담당. */
  private long lead;

  private String key;
  private long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    lead = human();
    key = "WR" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
    projectId = projectService.create(pm, new CreateProjectRequest(key, "조치", "x", "TEAM")).id();
    TenantContext.set(1L);
    projectService.addMember(pm, key, new AddMemberRequest(lead, "MEMBER"));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────── 다시 시도 ─────────────────────────

  @Test
  @DisplayName(
      "BLOCKED 노드 RETRY — 옛 방문은 FAILED 로 닫히고(사유 유지) 같은 노드 새 방문 ACTIVE, 실행 RUNNING, AI 작업 SUBMITTED, 이벤트 RETRIED")
  void retry_createsNewNodeRun_sameNode() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "저장소 권한이 없습니다");
    long rowId = activeRowId(issue, bot);
    events.clear();

    JsonNode v = ok(recover(issue, "RETRY", null, null, 1), lead);

    List<Record> visits = nodeRuns(issue, "work");
    assertThat(visits).hasSize(2);
    // 닫힌 방문은 끝난 상태(FAILED)여야 한다(열린 방문 색인) — 처음 막힘은 waiting_reason·error 로 남는다.
    assertThat(visits.get(0).get(NODE_RUN.STATUS)).isEqualTo("FAILED");
    assertThat(visits.get(0).get(NODE_RUN.WAITING_REASON)).isEqualTo("BLOCKED");
    assertThat(visits.get(0).get(NODE_RUN.ERROR)).isEqualTo("저장소 권한이 없습니다");
    assertThat(visits.get(0).get(NODE_RUN.LEFT_AT)).isNotNull();
    assertThat(visits.get(1).get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(visits.get(1).get(NODE_RUN.LEFT_AT)).isNull();
    assertThat(visits.get(1).get(NODE_RUN.VISIT_NO)).isEqualTo(2);
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(runRevision(issue)).isEqualTo(2);
    assertThat(v.get("status").asString()).isEqualTo("RUNNING");
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("work");
    // 막혀 있던 같은 행을 SUBMITTED 로 되돌리고 다시 깨운다.
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeRowId(issue, bot)).isEqualTo(rowId);
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
    assertThat(wakes().getFirst().actorId()).isEqualTo(lead);
    assertThat(lastEvent(issue).get(WORKFLOW_RUN_EVENT.TYPE)).isEqualTo("RETRIED");
    assertThat(lastEvent(issue).get(WORKFLOW_RUN_EVENT.ACTOR_ID)).isEqualTo(lead);
  }

  @Test
  @DisplayName("BLOCKED 노드 RETRY — 같은 행이 SUBMITTED 로 돌아가며 막힘 note 를 지운다(막힌 이유는 node_run 에 남는다)")
  void retryAfterBlocked_clearsNote() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막힘");
    assertThat(activeNote(issue, bot)).isEqualTo("막힘");

    ok(recover(issue, "RETRY", null, null, 1), lead);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeNote(issue, bot)).isNull();
    assertThat(nodeRuns(issue, "work").get(0).get(NODE_RUN.ERROR)).isEqualTo("막힘");
  }

  @Test
  @DisplayName("막힌 AI 가 ON_ERROR 로 같은 노드에 다시 들어오면 SUBMITTED·막힘 note 없음")
  void reentryAfterBlocked_clearsNote() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(yaml(bot, "\n    onError: { to: work, assignTo: bot }"));
    reportOk(issue, bot, "BLOCKED", "막힘");

    ok(recover(issue, "ON_ERROR", null, null, 1), lead);

    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    assertThat(activeNote(issue, bot)).isNull();
  }

  @Test
  @DisplayName("FAILED 노드 RETRY — 끝난 작업 대신 새 SUBMITTED 를 연다")
  void retry_afterFailed_opensNewSubmitted() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "FAILED", "빌드가 깨졌습니다");
    events.clear();

    ok(recover(issue, "RETRY", null, null, 1), pm);

    List<Record> visits = nodeRuns(issue, "work");
    assertThat(visits).hasSize(2);
    assertThat(visits.get(0).get(NODE_RUN.STATUS)).isEqualTo("FAILED");
    assertThat(visits.get(0).get(NODE_RUN.LEFT_AT)).isNotNull();
    assertThat(visits.get(1).get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(allStates(issue, bot)).containsExactly("FAILED", "SUBMITTED");
    assertThat(wakes()).hasSize(1);
    assertThat(runEvents(issue)).contains("RETRIED");
  }

  @Test
  @DisplayName("RETRY 는 방문 수에 세지 않는다 — maxVisits 에 이미 닿은 노드를 다시 시도해도 방문 한도 알림이 다시 나지 않는다")
  void retry_atVisitLimit_notCounted() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(yaml(bot, "\n    maxVisits: 1"));
    // 첫 진입이 이미 한도(1)에 닿았다.
    assertThat(runEvents(issue)).filteredOn("VISIT_LIMIT"::equals).hasSize(1);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");
    events.clear();

    ok(recover(issue, "RETRY", null, null, 1), lead);

    assertThat(nodeRuns(issue, "work")).hasSize(2);
    assertThat(runEvents(issue)).filteredOn("VISIT_LIMIT"::equals).hasSize(1);
    assertThat(events.stream(WorkflowVisitLimitReached.class)).isEmpty();
    // 다시 시도 뒤 또 막혀 또 다시 시도해도 세지 않는다(앞 다시 시도 방문도 세지 않으므로).
    reportOk(issue, bot, "BLOCKED", "또 막혔습니다");
    ok(recover(issue, "RETRY", null, null, 3), lead);
    assertThat(nodeRuns(issue, "work")).hasSize(3);
    assertThat(runEvents(issue)).filteredOn("VISIT_LIMIT"::equals).hasSize(1);
  }

  @Test
  @DisplayName(
      "같은 노드로 가는 ON_ERROR 는 다시 시도가 아니라 방문 수에 센다 — maxVisits 3 이면 두 번째 ON_ERROR(세 번째 방문)에 한도 알림")
  void onError_toSameNode_countsTowardVisitLimit() {
    long bot = agent("EXTERNAL");
    long issue =
        startedIssue(yaml(bot, "\n    maxVisits: 3\n    onError: { to: work, assignTo: bot }"));
    reportOk(issue, bot, "BLOCKED", "막혔습니다");
    ok(recover(issue, "ON_ERROR", null, null, 1), lead);
    // 두 번째 방문 — 아직 한도(3) 전이다.
    assertThat(runEvents(issue)).filteredOn("VISIT_LIMIT"::equals).isEmpty();
    reportOk(issue, bot, "BLOCKED", "또 막혔습니다");
    events.clear();

    ok(recover(issue, "ON_ERROR", null, null, 3), lead);

    // 앞 ON_ERROR 방문도 세므로 세 번째 방문에서 한도에 닿는다(방문 순서로 다시 시도라 짐작하면 둘 다 빠져 알림이 없었다).
    assertThat(nodeRuns(issue, "work")).hasSize(3);
    assertThat(runEvents(issue)).filteredOn("VISIT_LIMIT"::equals).hasSize(1);
    assertThat(events.stream(WorkflowVisitLimitReached.class)).hasSize(1);
  }

  @Test
  @DisplayName("자동 연쇄 한도로 멈춘 실행의 RETRY — 멈춘 decision 부터 새 연쇄 계수로 다시 지나 다음 노드에 머문다")
  void retry_afterAutoLimit_reroutesFromDecision() {
    long dev = agent("EXTERNAL");
    long issue = startedIssue(chainYaml(dev, 21));
    // triage → d1…d21 — 20 단계를 넘어 d21 에서 멈춘다.
    ok(
        post(API + "/issues/" + issue + "/workflow/move")
            .content(
                json(
                    "fromNode",
                    "triage",
                    "outcome",
                    "go",
                    "expectedRevision",
                    0,
                    "idempotencyKey",
                    "k1")),
        lead);
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");

    JsonNode v = ok(recover(issue, "RETRY", null, null, 1), lead);

    assertThat(v.get("status").asString()).isEqualTo("RUNNING");
    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("dev");
    List<Record> d21 = nodeRuns(issue, "d21");
    assertThat(d21).extracting(r -> r.get(NODE_RUN.STATUS)).containsExactly("FAILED", "COMPLETED");
    assertThat(activeStates(issue, dev)).containsExactly("SUBMITTED");
    assertThat(runEvents(issue)).contains("RETRIED");
  }

  @Test
  @DisplayName("멈춘 동안 사람이 이슈 담당에서 뺀 AI 는 RETRY 가 다시 넣거나 깨우지 않는다 — 남은 노드 담당만 다시 맡는다")
  void retry_afterAgentRemovedFromIssue_doesNotWakeRemoved() {
    long bot = agent("EXTERNAL");
    long bot2 = agent("EXTERNAL");
    long issue = startedIssue(pairYaml(bot, bot2));
    // 사람 노드(triage)에서 두 AI 에게 함께 넘긴다.
    ok(
        post(API + "/issues/" + issue + "/workflow/move")
            .content(
                om.writeValueAsString(
                    Map.of(
                        "fromNode", "triage",
                        "outcome", "go",
                        "assigneeIds", List.of(bot, bot2),
                        "expectedRevision", 0,
                        "idempotencyKey", "k1"))),
        lead);
    assertThat(activeStates(issue, bot2)).containsExactly("SUBMITTED");
    reportOk(issue, bot, "BLOCKED", "막혔습니다");
    // 멈춘 동안 사람이 bot2 를 이슈 담당에서 뺀다 — 그 작업은 담당 해제 규칙대로 CANCELED.
    ok(assign(issue, lead, bot), pm);
    assertThat(allStates(issue, bot2)).containsExactly("CANCELED");
    events.clear();

    ok(recover(issue, "RETRY", null, null, 2), lead);

    // 빠진 bot2 는 새 SUBMITTED 도 깨우기도 없고, 이슈 담당으로 돌아오지 않는다.
    assertThat(allStates(issue, bot2)).containsExactly("CANCELED");
    assertThat(issueAssignees(issue)).doesNotContain(bot2).contains(bot);
    assertThat(wakes()).hasSize(1);
    assertThat(wakes().getFirst().agentIds()).containsExactly(bot);
    assertThat(activeStates(issue, bot)).containsExactly("SUBMITTED");
    List<Record> visits = nodeRuns(issue, "work");
    assertThat(visits).hasSize(2);
    assertThat(visits.get(1).get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
  }

  @Test
  @DisplayName("멈춘 노드의 담당이 모두 이슈에서 빠졌으면 RETRY 는 422 WORKFLOW_ASSIGNEE_REQUIRED 이고 아무것도 바뀌지 않는다")
  void retry_allNodeAssigneesRemoved_422() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");
    ok(assign(issue, lead), pm);
    events.clear();

    JsonNode body = expect(recover(issue, "RETRY", null, null, 1), lead, 422);

    assertThat(code(body)).isEqualTo("WORKFLOW_ASSIGNEE_REQUIRED");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runRevision(issue)).isEqualTo(1);
    assertThat(nodeRuns(issue, "work")).hasSize(1);
    assertThat(allStates(issue, bot)).containsExactly("CANCELED");
    assertThat(issueAssignees(issue)).doesNotContain(bot);
    assertThat(wakes()).isEmpty();
  }

  // ───────────────────────── onError ─────────────────────────

  @Test
  @DisplayName(
      "ON_ERROR — onError.to 로 이동(assignTo 적용), 막힌 방문은 FAILED 로 닫히고 AI 작업은 COMPLETED, 이벤트 ON_ERROR_MOVED")
  void onError_movesToDefinedTarget() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");

    JsonNode v = ok(recover(issue, "ON_ERROR", null, "사람이 정리합니다", 1), lead);

    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("triage");
    assertThat(runStatus(issue)).isEqualTo("WAITING");
    Record left = nodeRuns(issue, "work").getFirst();
    assertThat(left.get(NODE_RUN.STATUS)).isEqualTo("FAILED");
    assertThat(left.get(NODE_RUN.WAITING_REASON)).isEqualTo("BLOCKED");
    assertThat(left.get(NODE_RUN.LEFT_AT)).isNotNull();
    assertThat(nodeRuns(issue, "triage").getFirst().get(NODE_RUN.STATUS)).isEqualTo("ACTIVE");
    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
    Record ev = lastEventOfType(issue, "ON_ERROR_MOVED");
    JsonNode payload = om.readTree(ev.get(WORKFLOW_RUN_EVENT.PAYLOAD).data());
    assertThat(payload.get("from").asString()).isEqualTo("work");
    assertThat(payload.get("to").asString()).isEqualTo("triage");
    // 의견은 이동 의견과 같은 경로로 이슈 댓글이 된다.
    assertThat(commentBodies(issue)).contains("사람이 정리합니다");
  }

  @Test
  @DisplayName("ON_ERROR — 노드에 onError 가 없으면 422 WORKFLOW_NO_ON_ERROR, 아무것도 바뀌지 않는다")
  void onError_absent_422() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, false);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");

    JsonNode body = expect(recover(issue, "ON_ERROR", null, null, 1), lead, 422);

    assertThat(code(body)).isEqualTo("WORKFLOW_NO_ON_ERROR");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
    assertThat(runRevision(issue)).isEqualTo(1);
  }

  // ───────────────────────── 관리자 옮기기 ─────────────────────────

  @Test
  @DisplayName(
      "MOVE_TO — 일반 구성원은 403 WORKFLOW_NOT_MANAGER, OWNER 는 200·이벤트 OVERRIDE_MOVED(from·to·행위자)")
  void moveTo_requiresManager_recordedAsOverride() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");

    JsonNode denied = expect(recover(issue, "MOVE_TO", "check", null, 1), lead, 403);
    assertThat(code(denied)).isEqualTo("WORKFLOW_NOT_MANAGER");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");

    JsonNode v = ok(recover(issue, "MOVE_TO", "check", "관리자가 넘깁니다", 1), pm);

    assertThat(v.get("currentNode").get("key").asString()).isEqualTo("check");
    assertThat(runStatus(issue)).isEqualTo("WAITING");
    assertThat(nodeRuns(issue, "work").getFirst().get(NODE_RUN.STATUS)).isEqualTo("FAILED");
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
    Record ev = lastEventOfType(issue, "OVERRIDE_MOVED");
    assertThat(ev.get(WORKFLOW_RUN_EVENT.ACTOR_ID)).isEqualTo(pm);
    JsonNode payload = om.readTree(ev.get(WORKFLOW_RUN_EVENT.PAYLOAD).data());
    assertThat(payload.get("from").asString()).isEqualTo("work");
    assertThat(payload.get("to").asString()).isEqualTo("check");
    assertThat(payload.get("actor").asLong()).isEqualTo(pm);
    assertThat(payload.get("commentId").isNull()).isFalse();
  }

  @Test
  @DisplayName("MOVE_TO — 대상 노드가 없거나 빠졌거나 start 면 모두 422 WORKFLOW_RECOVER_TARGET_INVALID")
  void moveTo_unknownNode_422() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");

    assertThat(code(expect(recover(issue, "MOVE_TO", "nowhere", null, 1), pm, 422)))
        .isEqualTo("WORKFLOW_RECOVER_TARGET_INVALID");
    assertThat(code(expect(recover(issue, "MOVE_TO", "start", null, 1), pm, 422)))
        .isEqualTo("WORKFLOW_RECOVER_TARGET_INVALID");
    assertThat(code(expect(recover(issue, "MOVE_TO", null, null, 1), pm, 422)))
        .isEqualTo("WORKFLOW_RECOVER_TARGET_INVALID");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
  }

  @Test
  @DisplayName("MOVE_TO end — 실행은 보통처럼 COMPLETED 로 끝난다")
  void moveTo_end_completesRun() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");
    events.clear();

    ok(recover(issue, "MOVE_TO", "end", null, 1), pm);

    assertThat(runStatus(issue)).isEqualTo("COMPLETED");
    assertThat(events.stream(WorkflowRunEnded.class).map(WorkflowRunEnded::status))
        .containsExactly("COMPLETED");
    assertThat(allStates(issue, bot)).containsExactly("COMPLETED");
  }

  // ───────────────────────── 취소 ─────────────────────────

  @Test
  @DisplayName("CANCEL — 실행 CANCELED·열린 방문 CANCELED·AI 작업 CANCELED·RunEnded(CANCELED)")
  void cancel_endsRunAndAgentWork() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");
    events.clear();

    JsonNode v = ok(recover(issue, "CANCEL", null, null, 1), lead);

    assertThat(v.get("status").asString()).isEqualTo("CANCELED");
    assertThat(runStatus(issue)).isEqualTo("CANCELED");
    Record visit = nodeRuns(issue, "work").getFirst();
    assertThat(visit.get(NODE_RUN.STATUS)).isEqualTo("CANCELED");
    assertThat(visit.get(NODE_RUN.LEFT_AT)).isNotNull();
    assertThat(activeStates(issue, bot)).isEmpty();
    assertThat(allStates(issue, bot)).containsExactly("CANCELED");
    assertThat(events.stream(WorkflowRunEnded.class).map(WorkflowRunEnded::status))
        .containsExactly("CANCELED");
    assertThat(wakes()).isEmpty();
    Record ev = lastEventOfType(issue, "RUN_CANCELED");
    assertThat(ev.get(WORKFLOW_RUN_EVENT.ACTOR_ID)).isEqualTo(lead);
  }

  // ───────────────────────── 공통 거절 ─────────────────────────

  @Test
  @DisplayName("멈추지 않은(ACTIVE 노드) 실행의 조치는 409 WORKFLOW_NOT_SUSPENDED")
  void recover_onActiveNode_409() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);

    JsonNode body = expect(recover(issue, "RETRY", null, null, 0), lead, 409);

    assertThat(code(body)).isEqualTo("WORKFLOW_NOT_SUSPENDED");
    assertThat(runStatus(issue)).isEqualTo("RUNNING");
    assertThat(nodeRuns(issue, "work")).hasSize(1);
  }

  @Test
  @DisplayName("본 뒤 revision 이 바뀌었으면 409 WORKFLOW_STALE(지금 revision 을 싣는다)")
  void recover_staleRevision_409() {
    long bot = agent("EXTERNAL");
    long issue = startedIssue(bot, true);
    reportOk(issue, bot, "BLOCKED", "막혔습니다");

    JsonNode body = expect(recover(issue, "CANCEL", null, null, 0), lead, 409);

    assertThat(code(body)).isEqualTo("WORKFLOW_STALE");
    assertThat(body.get("errors").get("revision").asString()).isEqualTo("1");
    assertThat(runStatus(issue)).isEqualTo("SUSPENDED");
  }

  @Test
  @DisplayName("활성 실행이 없으면 409 WORKFLOW_NOT_ACTIVE")
  void recover_noActiveRun_409() {
    long issue = issue(lead);

    JsonNode body = expect(recover(issue, "RETRY", null, null, 0), lead, 409);

    assertThat(code(body)).isEqualTo("WORKFLOW_NOT_ACTIVE");
  }

  // ───────────────────────── 도우미 ─────────────────────────

  /**
   * lead 가 담당이면 decision 을 지나 bot 이 맡는 work(agent_task)에 머무는 정의. withOnError 면 work 에 onError(→
   * triage, lead) 가 있다. check 는 관리자 옮기기의 대상(사람 노드)이다. triage 는 onError 가 없어도 닿는 노드여야
   * 게시되므로(NODE_UNREACHABLE) escalate 결과로도 잇는다.
   */
  private String yaml(long bot, boolean withOnError) {
    return yaml(bot, withOnError ? "\n    onError: { to: triage, assignTo: lead }" : "");
  }

  /** {@link #yaml(long, boolean)} 의 work 노드에 줄(앞에 줄바꿈·들여쓰기 4칸)을 더한 정의. */
  private String yaml(long bot, String workExtra) {
    return """
    schema: genia/workflow@1
    name: 조치
    roles:
      lead: { members: ["%s"] }
      bot: { members: ["%s"] }
    nodes:
      start: { type: start }
      route: { type: decision, default: work }
      work:
        type: agent_task
        role: bot
        instructions: 작업%s
        outcomes:
          done: { to: check, assignTo: lead }
          escalate: { to: triage, assignTo: lead }
      triage: { type: human_task, role: lead, outcomes: { ok: { to: end } } }
      check: { type: human_task, role: lead, outcomes: { ok: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: route }
    """
        .formatted(username(lead), username(bot), workExtra);
  }

  /**
   * n 개의 decision 이 줄지은 정의 — triage(lead) 의 go 가 d1 로 가고 dn 이 dev(개발 AI) 로 간다. 21 이면 연쇄 한도(20)를
   * 넘는다.
   */
  private String chainYaml(long dev, int n) {
    StringBuilder nodes = new StringBuilder();
    for (int i = 1; i <= n; i++) {
      nodes.append("  d").append(i).append(": { type: decision, default: ");
      nodes.append(i == n ? "dev" : "d" + (i + 1)).append(" }\n");
    }
    return """
    schema: genia/workflow@1
    name: 긴 연쇄
    roles:
      lead: { members: ["%s"] }
      developer: { members: ["%s"] }
    nodes:
      start: { type: start }
      triage: { type: agent_task, role: lead, instructions: 분류, outcomes: { go: { to: d1, assignTo: developer } } }
    %s  dev: { type: agent_task, role: developer, instructions: 개발, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: triage }
    """
        .formatted(username(lead), username(dev), nodes);
  }

  /**
   * lead 가 담당이면 사람 노드 triage 에 머물고, triage 의 go 가 두 AI(bots 역할) 가 함께 맡는 work 로 가는 정의 — 한 노드에 AI 둘을
   * 둬 조치 다시 시도가 빠진 담당만 거르는지 본다.
   */
  private String pairYaml(long bot, long bot2) {
    return """
    schema: genia/workflow@1
    name: 둘이 함께
    roles:
      lead: { members: ["%s"] }
      bots: { members: ["%s", "%s"] }
    nodes:
      start: { type: start }
      triage: { type: human_task, role: lead, outcomes: { go: { to: work, assignTo: bots } } }
      work: { type: agent_task, role: bots, instructions: 작업, outcomes: { done: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: triage }
    """
        .formatted(username(lead), username(bot), username(bot2));
  }

  /** 담당 교체 REST(PUT assignees) — 관리자가 보낸다. */
  private MockHttpServletRequestBuilder assign(long issue, long... userIds) {
    List<Long> ids = new ArrayList<>();
    for (long u : userIds) {
      ids.add(u);
    }
    return put(API + "/projects/" + key + "/issues/" + issueNumber(issue) + "/assignees")
        .content(om.writeValueAsString(Map.of("userIds", ids)));
  }

  /** 지금 이슈 담당 id. */
  private List<Long> issueAssignees(long issue) {
    return dsl.select(ISSUE_ASSIGNEE.USER_ID)
        .from(ISSUE_ASSIGNEE)
        .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(issue))
        .fetch(ISSUE_ASSIGNEE.USER_ID);
  }

  private MockHttpServletRequestBuilder recover(
      long issue, String action, String toNode, String comment, int revision) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("action", action);
    if (toNode != null) body.put("toNode", toNode);
    if (comment != null) body.put("comment", comment);
    body.put("expectedRevision", revision);
    return post(API + "/issues/" + issue + "/workflow/recover")
        .content(om.writeValueAsString(body));
  }

  /** lead 가 담당인 이슈에 정의를 시작해 bot 이 맡는 work 에 머물게 한 이슈 id. */
  private long startedIssue(long bot, boolean withOnError) {
    return startedIssue(yaml(bot, withOnError));
  }

  /** lead 가 담당인 이슈에 주어진 정의를 시작한 이슈 id. */
  private long startedIssue(String yaml) {
    long wf = publish(yaml);
    long issue = issue(lead);
    ok(
        post(API + "/issues/" + issue + "/workflow/start")
            .content(json("workflowId", wf, "dryRun", false)),
        pm);
    return issue;
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  /** 프로젝트 구성원 AI — runtime 은 INTERNAL|EXTERNAL. */
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
                .content(json("title", "이슈", "assigneeIds", List.of())),
            pm,
            200);
    long id = body.get("id").asLong();
    seedAssignees(id, assignees);
    return id;
  }

  /**
   * 시험 준비 — 담당을 이슈 생성·담당 교체 API 가 아니라 행으로 바로 넣는다. WP-2120 이후 API 로 시작 조건에 맞는 담당을 넣으면 실행이 자동으로 시작돼,
   * 「담당만 있고 아직 시작 전」 이슈를 시험이 직접 시작(start)하는 이 시험의 흐름과 부딪히기 때문이다.
   */
  private void seedAssignees(long issue, long... users) {
    com.workplace.support.TestFixtures.seedAssignees(dsl, pm, issue, users);
  }

  /** 실제 보고 REST(PUT agent-work) — 그 AI 의 ak_ 키와 수행 도구 헤더로 보낸다. 200 을 기대한다. */
  private void reportOk(long issue, long worker, String state, String note) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("state", state);
    body.put("note", note);
    var req =
        put(API + "/projects/" + key + "/issues/" + issueNumber(issue) + "/agent-work")
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(body))
            .header(
                "Authorization",
                "Bearer "
                    + agentKeyService
                        .issue(pm, worker, new IssueAgentKeyRequest("wf"))
                        .plaintextKey())
            .header(AgentToolContext.HEADER, "claude-code");
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      assertThat(response.getStatus()).as("%s", text).isEqualTo(200);
    } catch (Exception e) {
      throw new IllegalStateException("보고 실패", e);
    } finally {
      TenantContext.set(1L);
    }
  }

  private int issueNumber(long issue) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issue)).fetchSingle(ISSUE.NUMBER);
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

  /** 그 노드의 방문 행(들어간 순서). */
  private List<Record> nodeRuns(long issue, String nodeKey) {
    return dsl
        .select(
            NODE_RUN.STATUS,
            NODE_RUN.ERROR,
            NODE_RUN.LEFT_AT,
            NODE_RUN.VISIT_NO,
            NODE_RUN.WAITING_REASON)
        .from(NODE_RUN)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(NODE_RUN.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .and(NODE_RUN.NODE_KEY.eq(nodeKey))
        .orderBy(NODE_RUN.ID)
        .fetch()
        .stream()
        .map(r -> (Record) r)
        .toList();
  }

  private String runStatus(long issue) {
    return dsl.select(WORKFLOW_RUN.STATUS)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.STATUS);
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

  /** 가장 최근 실행 이벤트. */
  private Record lastEvent(long issue) {
    return dsl.select(
            WORKFLOW_RUN_EVENT.TYPE, WORKFLOW_RUN_EVENT.ACTOR_ID, WORKFLOW_RUN_EVENT.PAYLOAD)
        .from(WORKFLOW_RUN_EVENT)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .orderBy(WORKFLOW_RUN_EVENT.ID.desc())
        .limit(1)
        .fetchSingle();
  }

  /** 그 type 의 가장 최근 실행 이벤트. */
  private Record lastEventOfType(long issue, String type) {
    return dsl.select(
            WORKFLOW_RUN_EVENT.TYPE, WORKFLOW_RUN_EVENT.ACTOR_ID, WORKFLOW_RUN_EVENT.PAYLOAD)
        .from(WORKFLOW_RUN_EVENT)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .and(WORKFLOW_RUN_EVENT.TYPE.eq(type))
        .orderBy(WORKFLOW_RUN_EVENT.ID.desc())
        .limit(1)
        .fetchSingle();
  }

  /** 이슈 댓글 본문. */
  private List<String> commentBodies(long issue) {
    return dsl.select(ISSUE_COMMENT.BODY)
        .from(ISSUE_COMMENT)
        .where(ISSUE_COMMENT.ISSUE_ID.eq(issue))
        .fetch(ISSUE_COMMENT.BODY);
  }

  private static String code(JsonNode body) {
    return body.get("errors").get("code").asString();
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
