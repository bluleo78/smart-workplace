package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.workplace.global.ai.SharedAiMemoryReader;
import com.workplace.global.outbound.AiAgentEventClient;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.EventEnvelope;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.outbound.IssueEventDispatcher;
import com.workplace.issue.outbound.WorkflowRunEvents.WorkflowNodeWakeEvent;
import com.workplace.issue.outbound.WorkflowWakeContextReader;
import com.workplace.issue.service.IssueRecurrenceService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.service.ServerAgentResolver;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.ObjectProvider;
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
 * WP-1994 내부 AI 의 워크플로우 agent_task 작업 — api 쪽 계약 통합 테스트.
 *
 * <p>(1) 노드 깨우기 발사에 workflow {runId,nodeKey} 표지가 실리는지, (2) 내부 AI 자격(Internal 토큰 + X-On-Behalf-Of)으로
 * 결과 이동·ask 이동이 되는지, (3) ask 에 의견이 없으면 거절되는지 본다. 요청은 시험 트랜잭션에 합류하고 롤백되며, 커밋 뒤 리스너는 돌지 않으므로 기록된 깨우기
 * 이벤트를 이 스레드에서 만든 디스패처(ai-agent 클라이언트는 목)로 직접 발사한다.
 */
@RecordApplicationEvents
@Transactional
class InternalAgentWorkflowTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired ApplicationEvents events;
  @Autowired ServerAgentResolver resolver;
  @Autowired SharedAiMemoryReader sharedReader;
  @Autowired WorkflowWakeContextReader wakeReader;
  @Autowired ObjectProvider<IssueRecurrenceService> recurrence;

  private long pm;
  private long lead;
  private long bot;
  private String key;
  private long projectId;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    lead = human();
    key = "IA" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
    projectId = projectService.create(pm, new CreateProjectRequest(key, "내부", "x", "TEAM")).id();
    TenantContext.set(1L);
    projectService.addMember(pm, key, new AddMemberRequest(lead, "MEMBER"));
    bot = internalAgent();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("노드 진입 깨우기를 발사하면 내부 AI 마다 issue.assigned 에 workflow 표지가 실린다")
  void internalAgent_onNodeEntered_dispatchesWorkflowPayload() {
    long issue = startedIssue();

    List<EventEnvelope> sent = fire(wakes().getFirst());

    assertThat(sent).hasSize(1);
    assertThat(sent.getFirst().type()).isEqualTo("issue.assigned");
    assertThat(sent.getFirst().payload()).containsEntry("actingAgentId", bot);
    assertThat(sent.getFirst().payload())
        .containsEntry("workflow", Map.of("runId", runId(issue), "nodeKey", "dev"));
  }

  @Test
  @DisplayName("노드에 내부 AI 가 둘이면 첫 AI 하나만 발사하고 payload added 에도 그 AI 만 담긴다")
  void internalTwoAgents_firesFirstOnly_addedHasOnlyWoken() {
    long second = internalAgent();
    String twoBots =
        yaml()
            .replace(
                "bot: { members: [\"" + username(bot) + "\"] }",
                "bot: { members: [\"" + username(bot) + "\", \"" + username(second) + "\"] }");
    long wf = publish(twoBots);
    // 시작하려면 노드 역할의 사람이 이슈 담당에 있어야 한다 — 둘 다 담당에 넣는다.
    long issue = issue(lead, bot, second);
    events.clear();
    expectHuman(
        post(API + "/issues/" + issue + "/workflow/start")
            .content(json("workflowId", wf, "dryRun", false)));

    List<EventEnvelope> sent = fire(wakes().getFirst());

    assertThat(sent).hasSize(1);
    assertThat(sent.getFirst().payload()).containsEntry("actingAgentId", bot);
    // added 는 깨운 내부 AI(bot)만 — 깨우지 않은 둘째 AI 를 담으면 받은 AI 가 그 AI 도 깨어난 줄 안다.
    List<?> added = (List<?>) sent.getFirst().payload().get("added");
    assertThat(added).hasSize(1);
    assertThat(String.valueOf(added.getFirst())).contains(username(bot));
    assertThat(String.valueOf(added.getFirst())).doesNotContain(username(second));
  }

  @Test
  @DisplayName("내부 AI 자격으로 결과를 골라 이동하면 다음 노드로 가고 dev 방문이 COMPLETED 가 된다")
  void internalAgent_movesWithOutcome() {
    long issue = startedIssue();

    internalMove(issue, "dev", "done", null, 0, 200);

    assertThat(runCurrentNode(issue)).isEqualTo("check");
    assertThat(
            dsl.select(NODE_RUN.STATUS)
                .from(NODE_RUN)
                .join(WORKFLOW_RUN)
                .on(WORKFLOW_RUN.ID.eq(NODE_RUN.RUN_ID))
                .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
                .and(NODE_RUN.NODE_KEY.eq("dev"))
                .fetchSingle(NODE_RUN.STATUS))
        .isEqualTo("COMPLETED");
  }

  @Test
  @DisplayName("ask 결과로 질문하면 WAITING·dev_ask 가 되고(agent_work 행 없음) 답변 뒤 같은 AI 에게 dev 표지로 다시 발사된다")
  void internalAgent_asksViaAskOutcome() {
    long issue = startedIssue();
    long runId = runId(issue);
    internalMove(issue, "dev", "ask", "질문?", 0, 200);

    assertThat(runStatus(issue)).isEqualTo("WAITING");
    assertThat(runCurrentNode(issue)).isEqualTo("dev_ask");
    // 내부 AI 는 agent_work 행을 갖지 않는다(WP-1986: 진입 때 SUBMITTED 도 없다) — 질문 상태는 실행 WAITING·dev_ask 노드가
    // 나타낸다.
    assertThat(agentWorkStates(issue)).isEmpty();

    events.clear();
    expectHuman(move(issue, "dev_ask", "answered", "A 로", 1));

    List<WorkflowNodeWakeEvent> wakes = wakes();
    assertThat(wakes).hasSize(1);
    List<EventEnvelope> sent = fire(wakes.getFirst());
    assertThat(sent).hasSize(1);
    assertThat(sent.getFirst().payload()).containsEntry("actingAgentId", bot);
    assertThat(sent.getFirst().payload())
        .containsEntry("workflow", Map.of("runId", runId, "nodeKey", "dev"));
  }

  @Test
  @DisplayName("의견 없이 ask 로 이동하면 422 WORKFLOW_COMMENT_REQUIRED 로 거절되고 실행은 그대로다")
  void internalAgent_askWithoutComment_rejected() {
    long issue = startedIssue();
    int revision = runRevision(issue);

    JsonNode err = internalMove(issue, "dev", "ask", null, 0, 422);

    assertThat(err.toString()).contains("WORKFLOW_COMMENT_REQUIRED");
    assertThat(runRevision(issue)).isEqualTo(revision);
    assertThat(runCurrentNode(issue)).isEqualTo("dev");
  }

  // ───────────────────────── 도우미 ─────────────────────────

  /** 깨우기 이벤트를 이 스레드의 디스패처로 발사하고 ai-agent 로 나간 envelope 들을 돌려준다. */
  private List<EventEnvelope> fire(WorkflowNodeWakeEvent wake) {
    AiAgentEventClient client = mock(AiAgentEventClient.class);
    var props = new AiAgentProperties("http://ai-agent", "tok", true);
    var dispatcher =
        new IssueEventDispatcher(
            client,
            props,
            resolver,
            sharedReader,
            Runnable::run,
            recurrence,
            Runnable::run,
            wakeReader);
    dispatcher.onWorkflowNodeWake(wake);
    var captor = ArgumentCaptor.forClass(EventEnvelope.class);
    verify(client, times(wake.agentIds().isEmpty() ? 0 : 1).description("발사"))
        .publish(captor.capture());
    return captor.getAllValues();
  }

  private List<WorkflowNodeWakeEvent> wakes() {
    return events.stream(WorkflowNodeWakeEvent.class).toList();
  }

  /** lead 가 담당인 이슈에 정의를 시작해 내부 AI(bot)가 맡는 dev 에 머물게 한다. 깨우기 이벤트는 남긴다. */
  private long startedIssue() {
    long wf = publish(yaml());
    long issue = issue(lead);
    events.clear();
    expectHuman(
        post(API + "/issues/" + issue + "/workflow/start")
            .content(json("workflowId", wf, "dryRun", false)));
    return issue;
  }

  /**
   * dev(내부 AI): done → check(lead), ask → dev_ask(lead, returnTo dev). dev_ask 의 answered 는 dev 로
   * 되돌린다.
   */
  private String yaml() {
    return """
    schema: genia/workflow@1
    name: 내부
    roles:
      lead: { members: ["%s"] }
      bot: { members: ["%s"] }
    nodes:
      start: { type: start }
      route: { type: decision, default: dev }
      dev:
        type: agent_task
        role: bot
        instructions: 작업
        outcomes:
          done: { to: check, assignTo: lead }
          ask: { to: dev_ask, assignTo: lead, requireComment: true }
      dev_ask:
        type: human_task
        role: lead
        returnTo: dev
        outcomes:
          answered: { to: dev, assignTo: keep, requireComment: true }
      check: { type: human_task, role: lead, outcomes: { ok: { to: end } } }
      end: { type: end }
    start:
      - { when: { assigneeRole: lead }, to: route }
    """
        .formatted(username(lead), username(bot));
  }

  /** 내부 AI(bot)를 ai-agent 와 같은 Internal 토큰 + X-On-Behalf-Of 로 대행시켜 이동한다. */
  private JsonNode internalMove(
      long issue, String from, String outcome, String comment, int revision, int status) {
    var req = move(issue, from, outcome, comment, revision);
    req.contentType(MediaType.APPLICATION_JSON)
        .header("Authorization", "Internal test-token")
        .header("X-On-Behalf-Of", String.valueOf(bot))
        .header("X-On-Behalf-Of-Tenant", "1");
    return perform(req, status);
  }

  private MockHttpServletRequestBuilder move(
      long issue, String from, String outcome, String comment, int revision) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("fromNode", from);
    body.put("outcome", outcome);
    if (comment != null) body.put("comment", comment);
    body.put("expectedRevision", revision);
    body.put("idempotencyKey", UUID.randomUUID().toString());
    return post(API + "/issues/" + issue + "/workflow/move").content(om.writeValueAsString(body));
  }

  private JsonNode expectHuman(MockHttpServletRequestBuilder req) {
    return asHuman(req, 200);
  }

  /** 프로젝트 소유자(pm) JWT 로 호출하고 기대 상태를 확인한다. */
  private JsonNode asHuman(MockHttpServletRequestBuilder req, int status) {
    req.contentType(MediaType.APPLICATION_JSON)
        .header("Authorization", "Bearer " + jwt.generateAccessToken(pm, "u-" + pm, 1L));
    return perform(req, status);
  }

  private JsonNode perform(MockHttpServletRequestBuilder req, int status) {
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

  /** 이 프로젝트에 게시하고 켠 정의 id. */
  private long publish(String yaml) {
    var create =
        post(API + "/projects/" + projectId + "/workflows")
            .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml));
    long id = asHuman(create, 201).get("id").asLong();
    asHuman(post(API + "/workflows/" + id + "/publish"), 200);
    asHuman(patch(API + "/workflows/" + id).content(json("enabled", true)), 200);
    return id;
  }

  private long issue(long... assignees) {
    List<Long> ids = new ArrayList<>();
    for (long a : assignees) ids.add(a);
    long id =
        expectHuman(
                post(API + "/projects/" + key + "/issues")
                    .content(json("title", "이슈", "assigneeIds", List.of())))
            .get("id")
            .asLong();
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

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  /** 프로젝트 구성원인 내부(INTERNAL) AI. */
  private long internalAgent() {
    long id = withMembership(TestFixtures.createAgentNoToken(dsl));
    dsl.update(USER).set(USER.AGENT_RUNTIME, "INTERNAL").where(USER.ID.eq(id)).execute();
    // 실제 AI 는 issue:write 를 가진 역할로 등록된다 — 직접 이동하려면 USER 역할이 필요하다.
    TestFixtures.grantRole(dsl, id, "USER");
    projectMemberRepository.insert(projectId, id, "MEMBER");
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  private long runId(long issue) {
    return dsl.select(WORKFLOW_RUN.ID)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.ID);
  }

  private int runRevision(long issue) {
    return dsl.select(WORKFLOW_RUN.REVISION)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.REVISION);
  }

  private String runStatus(long issue) {
    return dsl.select(WORKFLOW_RUN.STATUS)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.STATUS);
  }

  private String runCurrentNode(long issue) {
    return dsl.select(WORKFLOW_RUN.CURRENT_NODE)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .fetchSingle(WORKFLOW_RUN.CURRENT_NODE);
  }

  private List<String> agentWorkStates(long issue) {
    return dsl.select(AGENT_WORK.STATE)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issue))
        .and(AGENT_WORK.WORKER_ID.eq(bot))
        .fetch(AGENT_WORK.STATE);
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
    return om.writeValueAsString(map);
  }
}
