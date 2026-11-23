package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.NODE_RUN;
import static com.workplace.jooq.Tables.NOTIFICATION;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_RUN_EVENT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.service.IssueClock;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.issue.workflow.service.WorkflowTimerService;
import com.workplace.jooq.tables.records.NodeRunRecord;
import com.workplace.notify.service.NotificationService;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1987 기다림 타이머(WorkflowTimerService)의 판정·중복 방지·불변 검증. 시각은 {@link IssueClock#now()} 를 방문의
 * entered_at 기준으로 고정해 「오래 머문」 상황을 만든다. 서비스는 시험 트랜잭션 안에서 직접 부른다(스케줄러는 테스트 프로필에서 꺼져 있다) — 방문
 * 트랜잭션(NESTED)은 이때 시험 트랜잭션의 세이브포인트로 돈다.
 *
 * <p>runDue 반환값(처리한 방문 수)은 테넌트 전체 수라 다른 테스트가 커밋해 남긴 ACTIVE 방문이 섞일 수 있다. 그래서 정확한 수를 단언하지 않고, 이 테스트가
 * 만든 이슈의 표시 이벤트(workflow_run_event TIMER_*)와 알림 받는 사람으로 판정한다(반환값은 「적어도 1」만 본다).
 */
@Transactional
class WorkflowTimerTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueClock issueClock;
  @MockitoSpyBean NotificationService notificationService;

  /** 후보 조회와 잠금 사이에 실행 상태를 바꾸는 시험용 스파이. */
  @MockitoSpyBean WorkflowRunRepository runRepository;

  @Autowired WorkflowTimerService timerService;

  /** 프로젝트 OWNER(관리자). */
  private long pm;

  /** 노드 담당(역할 owner). */
  private long worker;

  /** 질문하는 개발 역할. */
  private long dev;

  private String key;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    worker = human();
    dev = human();
    key = "WT" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
    projectService.create(pm, new CreateProjectRequest(key, "타이머", "x", "TEAM"));
    TenantContext.set(1L);
    projectService.addMember(pm, key, new AddMemberRequest(worker, "MEMBER"));
    projectService.addMember(pm, key, new AddMemberRequest(dev, "MEMBER"));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("timeout 없는 human_task 는 48시간 뒤 담당에게 한 번만 다시 알린다")
  void humanTask_after2Days_remindsAssigneeOnce() {
    long issue = startWork(humanYaml(null));
    NodeRunRecord visit = visit(issue, "work");
    Instant entered = visit.getEnteredAt().toInstant();

    runDue(entered.plus(Duration.ofHours(47)));
    assertTimerEvents(issue);

    assertThat(runDue(entered.plus(Duration.ofHours(48)))).isGreaterThanOrEqualTo(1);
    assertTimerEvents(issue, "TIMER_REMIND");
    JsonNode payload = payloads(issue, "TIMER_REMIND").get(0);
    assertThat(payload.get("nodeRunId").asLong()).isEqualTo(visit.getId());
    assertThat(payload.get("node").asString()).isEqualTo("work");
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).containsExactly(worker);

    runDue(entered.plus(Duration.ofHours(49)));
    assertThat(timerEvents(issue)).hasSize(1);
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).hasSize(1);
  }

  @Test
  @DisplayName("다시 알린 뒤 같은 기간이 또 지나면 관리자에게 한 번 알린다")
  void afterRemind_samePeriod_escalatesToManagers() {
    long issue = startWork(humanYaml(null));
    Instant entered = enteredAt(issue, "work");
    Instant remindAt = entered.plus(Duration.ofDays(2));
    runDue(remindAt);

    runDue(remindAt.plus(Duration.ofHours(47)));
    assertTimerEvents(issue, "TIMER_REMIND");
    assertThat(runDue(remindAt.plus(Duration.ofDays(2)))).isGreaterThanOrEqualTo(1);
    assertTimerEvents(issue, "TIMER_REMIND", "TIMER_ESCALATE");
    assertThat(recipients(issue, "WORKFLOW_TURN_ESCALATE")).containsExactly(pm);

    runDue(remindAt.plus(Duration.ofDays(9)));
    assertThat(timerEvents(issue)).hasSize(2);
    assertThat(recipients(issue, "WORKFLOW_TURN_ESCALATE")).hasSize(1);
  }

  @Test
  @DisplayName("타이머는 노드·실행 상태를 바꾸지 않는다")
  void timer_neverMovesNode() {
    long issue = startWork(humanYaml(null));
    Instant entered = enteredAt(issue, "work");
    var before = dsl.selectFrom(WORKFLOW_RUN).where(WORKFLOW_RUN.ISSUE_ID.eq(issue)).fetchSingle();
    String nodeStatus = visit(issue, "work").getStatus();

    runDue(entered.plus(Duration.ofDays(2)));
    runDue(entered.plus(Duration.ofDays(30)));

    var after = dsl.selectFrom(WORKFLOW_RUN).where(WORKFLOW_RUN.ISSUE_ID.eq(issue)).fetchSingle();
    assertTimerEvents(issue, "TIMER_REMIND", "TIMER_ESCALATE");
    assertThat(after.getCurrentNode()).isEqualTo(before.getCurrentNode());
    assertThat(after.getStatus()).isEqualTo(before.getStatus());
    assertThat(after.getRevision()).isEqualTo(before.getRevision());
    assertThat(visit(issue, "work").getStatus()).isEqualTo(nodeStatus);
  }

  @Test
  @DisplayName("떠난 방문과 취소된 실행에는 타이머가 없다")
  void completedNode_noTimer() {
    long left = startWork(humanYaml(null));
    Instant entered = enteredAt(left, "work");
    ok(moveReq(left, "work", "done", 0, "k1"), worker);
    assertThat(visit(left, "work").getStatus()).isEqualTo("COMPLETED");

    long canceled = startWork(humanYaml(null));
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "CANCELED")
        .set(WORKFLOW_RUN.ENDED_AT, java.time.OffsetDateTime.now())
        .where(WORKFLOW_RUN.ISSUE_ID.eq(canceled))
        .execute();

    runDue(entered.plus(Duration.ofDays(60)));

    assertTimerEvents(left);
    assertTimerEvents(canceled);
  }

  @Test
  @DisplayName("agent_task 는 timeout 을 적었을 때만 — PT1H 뒤 다시 알리고, 안 적으면 10일 뒤에도 없다")
  void agentTask_withExplicitTimeout_reminds() {
    long timed = startWork(agentYaml("timeout: { after: PT1H, then: remind }"));
    Instant entered = enteredAt(timed, "work");
    runDue(entered.plus(Duration.ofMinutes(59)));
    assertTimerEvents(timed);
    assertThat(runDue(entered.plus(Duration.ofHours(1)))).isGreaterThanOrEqualTo(1);
    assertTimerEvents(timed, "TIMER_REMIND");

    long plain = startWork(agentYaml(""));
    Instant enteredPlain = enteredAt(plain, "work");
    runDue(enteredPlain.plus(Duration.ofDays(10)));
    assertTimerEvents(plain);
  }

  @Test
  @DisplayName("returnTo 가 있는 답변 노드는 timeout 이 없으면 24시간에 다시 알린다")
  void answerNode_defaultsTo1Day() {
    long issue = startAsk();
    Instant entered = enteredAt(issue, "dev_ask");

    runDue(entered.plus(Duration.ofHours(23)));
    assertTimerEvents(issue);
    assertThat(runDue(entered.plus(Duration.ofHours(24)))).isGreaterThanOrEqualTo(1);
    assertTimerEvents(issue, "TIMER_REMIND");
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).containsExactly(worker);
  }

  @Test
  @DisplayName("then: escalate 는 다시 알림 없이 기한 뒤 바로 관리자에게 알린다")
  void thenEscalate_skipsRemind() {
    long issue = startWork(humanYaml("timeout: { after: PT3H, then: escalate }"));
    Instant entered = enteredAt(issue, "work");

    runDue(entered.plus(Duration.ofHours(2)));
    assertTimerEvents(issue);
    assertThat(runDue(entered.plus(Duration.ofHours(3)))).isGreaterThanOrEqualTo(1);
    runDue(entered.plus(Duration.ofDays(9)));

    assertTimerEvents(issue, "TIMER_ESCALATE");
    assertThat(recipients(issue, "WORKFLOW_TURN_ESCALATE")).containsExactly(pm);
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).isEmpty();
  }

  @Test
  @DisplayName("같은 노드에 다시 들어가면 새 방문이라 기간을 처음부터 센다")
  void newVisit_startsOver() {
    long issue = startWork(humanYaml(null));
    Instant first = enteredAt(issue, "work");
    runDue(first.plus(Duration.ofDays(2)));
    assertTimerEvents(issue, "TIMER_REMIND");

    ok(moveReq(issue, "work", "again", 0, "k1"), worker);
    ok(moveReq(issue, "work2", "back", 1, "k2"), worker);
    NodeRunRecord second = visit(issue, "work");
    assertThat(second.getStatus()).isEqualTo("ACTIVE");
    // 새 방문의 들어간 시각을 고정해 기준을 분명히 한다.
    Instant base = first.plus(Duration.ofDays(3));
    dsl.update(NODE_RUN)
        .set(NODE_RUN.ENTERED_AT, base.atOffset(java.time.ZoneOffset.UTC))
        .where(NODE_RUN.ID.eq(second.getId()))
        .execute();

    runDue(base.plus(Duration.ofHours(47)));
    // 47시간에는 새 방문이 아직 기한 전 — 새 방문(second)을 가리키는 다시 알림이 하나도 없어야 한다(첫 방문 것만 남는다).
    assertThat(payloads(issue, "TIMER_REMIND")).hasSize(1);
    assertThat(payloads(issue, "TIMER_REMIND"))
        .noneMatch(p -> p.get("nodeRunId").asLong() == second.getId());
    assertThat(runDue(base.plus(Duration.ofHours(48)))).isGreaterThanOrEqualTo(1);
    assertThat(payloads(issue, "TIMER_REMIND")).hasSize(2);
    assertThat(payloads(issue, "TIMER_REMIND").get(1).get("nodeRunId").asLong())
        .isEqualTo(second.getId());
  }

  @Test
  @DisplayName("담당이 없으면 표시 이벤트만 남기고 알림은 만들지 않는다")
  void noAssignee_remindEventOnly() {
    long issue = startWork(humanYaml(null));
    NodeRunRecord visit = visit(issue, "work");
    dsl.update(NODE_RUN)
        .set(NODE_RUN.ASSIGNEE_IDS, new Long[0])
        .where(NODE_RUN.ID.eq(visit.getId()))
        .execute();

    runDue(visit.getEnteredAt().toInstant().plus(Duration.ofDays(2)));

    assertTimerEvents(issue, "TIMER_REMIND");
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).isEmpty();
  }

  @Test
  @DisplayName("서비스를 두 번 돌려도 알림은 한 번만 나간다")
  void runDue_twice_notifiesOnce() {
    long issue = startWork(humanYaml(null));
    Instant now = enteredAt(issue, "work").plus(Duration.ofDays(3));

    assertThat(runDue(now)).isGreaterThanOrEqualTo(1);
    runDue(now);

    assertTimerEvents(issue, "TIMER_REMIND");
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).hasSize(1);
  }

  @Test
  @DisplayName("한 방문이 SQL 오류로 실패해도 다른 방문의 이벤트·알림은 남는다")
  void failingVisit_doesNotBlockOthers() {
    long bad = startWork(humanYaml(null));
    long good = startWork(humanYaml(null));
    Instant now = enteredAt(good, "work").plus(Duration.ofDays(3));
    // bad 이슈의 알림 단계에서 SQL 오류를 내 트랜잭션을 망가뜨린다(세이브포인트가 없으면 뒤 방문까지 실패한다).
    doAnswer(
            inv -> {
              if ((long) inv.getArgument(1) == bad) {
                dsl.execute("select 1/0");
              }
              return inv.callRealMethod();
            })
        .when(notificationService)
        .createWorkflowTurnAndFanOut(any(), anyLong(), any());

    assertThat(runDue(now)).isGreaterThanOrEqualTo(1);

    assertTimerEvents(bad);
    assertTimerEvents(good, "TIMER_REMIND");
    assertThat(recipients(good, "WORKFLOW_TURN_REMIND")).containsExactly(worker);
  }

  @Test
  @DisplayName("멈춘(SUSPENDED·BLOCKED) 실행의 방문에는 오래 지나도 알리지 않는다")
  void suspendedRun_noTimer() {
    long issue = startWork(humanYaml(null));
    NodeRunRecord visit = visit(issue, "work");
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "SUSPENDED")
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .execute();
    dsl.update(NODE_RUN)
        .set(NODE_RUN.STATUS, "BLOCKED")
        .where(NODE_RUN.ID.eq(visit.getId()))
        .execute();

    runDue(visit.getEnteredAt().toInstant().plus(Duration.ofDays(30)));

    assertTimerEvents(issue);
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).isEmpty();
  }

  @Test
  @DisplayName("후보 조회 뒤 잠그기 전에 실행이 멈추면(SUSPENDED) 알리지 않는다")
  void runSuspendedBetweenSnapshotAndLock_noTimer() {
    long issue = startWork(humanYaml(null));
    NodeRunRecord visit = visit(issue, "work");
    long visitId = visit.getId();
    long runId = visit.getRunId();
    // 후보 조회(RUNNING 이라 후보에 든다)가 끝난 뒤, 이 방문을 잠그기 직전에 실행을 멈춘다 — 다른 트랜잭션이 그 사이 멈춘 상황.
    doAnswer(
            inv -> {
              if ((long) inv.getArgument(1) == visitId) {
                dsl.update(WORKFLOW_RUN)
                    .set(WORKFLOW_RUN.STATUS, "SUSPENDED")
                    .where(WORKFLOW_RUN.ID.eq(runId))
                    .execute();
              }
              return inv.callRealMethod();
            })
        .when(runRepository)
        .lockActiveNodeRunOfOpenRun(anyLong(), anyLong());

    runDue(visit.getEnteredAt().toInstant().plus(Duration.ofDays(30)));

    // 잠그는 단계까지 갔는데도(후보였다) 잠금 쿼리가 열린 실행이 아니라고 보고 건너뛰었다.
    verify(runRepository).lockActiveNodeRunOfOpenRun(runId, visitId);
    assertTimerEvents(issue);
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).isEmpty();
    assertThat(recipients(issue, "WORKFLOW_TURN_ESCALATE")).isEmpty();
  }

  @Test
  @DisplayName("사람을 기다리는(WAITING) 실행의 human_task 방문에는 알린다")
  void waitingRun_humanTask_reminds() {
    long issue = startWork(humanYaml(null));
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "WAITING")
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .execute();
    assertThat(
            dsl.select(WORKFLOW_RUN.STATUS)
                .from(WORKFLOW_RUN)
                .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
                .fetchSingle()
                .value1())
        .isEqualTo("WAITING");

    runDue(enteredAt(issue, "work").plus(Duration.ofDays(2)));

    assertTimerEvents(issue, "TIMER_REMIND");
    assertThat(recipients(issue, "WORKFLOW_TURN_REMIND")).containsExactly(worker);
  }

  // ───────────────────────── 시험 도우미 ─────────────────────────

  /** 이슈의 노드 방문이 들어간 시각 — 「오래 머문」 시각을 이 시각 기준으로 만든다. */
  private Instant enteredAt(long issue, String node) {
    return visit(issue, node).getEnteredAt().toInstant();
  }

  /** 이슈에 남은 타이머 표시 이벤트(TIMER_*)가 순서까지 정확히 expected 인지 단언한다(없으면 빈 목록). */
  private void assertTimerEvents(long issue, String... expected) {
    assertThat(timerEvents(issue)).containsExactly(expected);
  }

  /** 시각을 고정하고 타이머를 한 번 돌린 뒤 처리한 방문 수(테넌트 전체 — 정확한 수는 단언하지 않는다)를 돌려준다. */
  private int runDue(Instant now) {
    doReturn(now).when(issueClock).now();
    return timerService.runDue(now);
  }

  /** 정의를 게시하고 worker 담당 이슈에서 실행을 시작해 이슈 id 를 돌려준다. */
  private long startWork(String yaml) {
    long wf = publish(yaml);
    long issue = issue(worker);
    ok(
        post(API + "/issues/" + issue + "/workflow/start")
            .content(json("workflowId", wf, "dryRun", false)),
        pm);
    return issue;
  }

  /** dev 가 담당인 이슈에서 시작해 질문(ask)으로 답변 노드 dev_ask(담당 worker)에 머물게 한다. */
  private long startAsk() {
    long wf = publish(askYaml());
    long issue = issue(dev);
    ok(
        post(API + "/issues/" + issue + "/workflow/start")
            .content(json("workflowId", wf, "dryRun", false)),
        pm);
    ok(moveReq(issue, "dev", "ask", 0, "k0", "질문입니다", List.of(worker)), dev);
    return issue;
  }

  private String humanYaml(String timeoutLine) {
    return """
    schema: genia/workflow@1
    name: 사람
    roles:
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      work:
        type: human_task
        role: owner
        %s
        outcomes: { done: { to: end }, again: { to: work2 } }
      work2:
        type: human_task
        role: owner
        outcomes: { back: { to: work, assignTo: keep } }
      end: { type: end }
    start:
      - { when: { assigneeRole: owner }, to: work }
    """
        .formatted(username(worker), timeoutLine == null ? "" : timeoutLine);
  }

  private String agentYaml(String timeoutLine) {
    return """
    schema: genia/workflow@1
    name: AI
    roles:
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      work:
        type: agent_task
        role: owner
        instructions: 작업
        %s
        outcomes: { done: { to: end } }
      end: { type: end }
    start:
      - { when: { assigneeRole: owner }, to: work }
    """
        .formatted(username(worker), timeoutLine);
  }

  private String askYaml() {
    return """
    schema: genia/workflow@1
    name: 질문
    roles:
      dev: { members: ["%s"] }
      owner: { members: ["%s"] }
    nodes:
      start: { type: start }
      dev:
        type: agent_task
        role: dev
        instructions: 개발
        outcomes:
          ask: { to: dev_ask, assignTo: owner, requireComment: true }
          done: { to: end }
      dev_ask:
        type: human_task
        role: owner
        returnTo: dev
        outcomes:
          answered: { to: dev, assignTo: keep, requireComment: true }
      end: { type: end }
    start:
      - { when: { assigneeRole: dev }, to: dev }
    """
        .formatted(username(dev), username(worker));
  }

  private MockHttpServletRequestBuilder moveReq(
      long issue, String from, String outcome, int revision, String idemKey) {
    return moveReq(issue, from, outcome, revision, idemKey, null, null);
  }

  private MockHttpServletRequestBuilder moveReq(
      long issue,
      String from,
      String outcome,
      int revision,
      String idemKey,
      String comment,
      List<Long> assignees) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("fromNode", from);
    body.put("outcome", outcome);
    if (assignees != null) body.put("assigneeIds", assignees);
    if (comment != null) body.put("comment", comment);
    body.put("expectedRevision", revision);
    body.put("idempotencyKey", idemKey);
    return post(API + "/issues/" + issue + "/workflow/move").content(om.writeValueAsString(body));
  }

  private long publish(String yaml) {
    JsonNode created =
        ok(
            post(API + "/projects/" + projectId() + "/workflows")
                .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml)),
            pm,
            201);
    long id = created.get("id").asLong();
    ok(post(API + "/workflows/" + id + "/publish"), pm, 200);
    ok(patch(API + "/workflows/" + id).content(json("enabled", true)), pm, 200);
    return id;
  }

  private long projectId() {
    return dsl.select(com.workplace.jooq.Tables.PROJECT.ID)
        .from(com.workplace.jooq.Tables.PROJECT)
        .where(com.workplace.jooq.Tables.PROJECT.KEY.eq(key))
        .fetchSingle()
        .value1();
  }

  private long issue(long assignee) {
    JsonNode body =
        ok(
            post(API + "/projects/" + key + "/issues")
                .content(json("title", "이슈", "assigneeIds", List.of(assignee))),
            pm);
    return body.get("id").asLong();
  }

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) map.put((String) pairs[i], pairs[i + 1]);
    return om.writeValueAsString(map);
  }

  private JsonNode ok(MockHttpServletRequestBuilder req, long caller) {
    return ok(req, caller, 200);
  }

  private JsonNode ok(MockHttpServletRequestBuilder req, long caller, int status) {
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

  /** 노드의 가장 최근 방문 행. */
  private NodeRunRecord visit(long issue, String node) {
    return dsl.selectFrom(NODE_RUN)
        .where(
            NODE_RUN
                .RUN_ID
                .in(
                    dsl.select(WORKFLOW_RUN.ID)
                        .from(WORKFLOW_RUN)
                        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue)))
                .and(NODE_RUN.NODE_KEY.eq(node)))
        .orderBy(NODE_RUN.ID.desc())
        .limit(1)
        .fetchSingle();
  }

  /** 이슈 실행의 타이머 이벤트 type(일어난 순서). */
  private List<String> timerEvents(long issue) {
    List<String> out = new ArrayList<>();
    for (String t : eventTypes(issue)) if (t.startsWith("TIMER_")) out.add(t);
    return out;
  }

  private List<String> eventTypes(long issue) {
    return dsl.select(WORKFLOW_RUN_EVENT.TYPE)
        .from(WORKFLOW_RUN_EVENT)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .fetch(WORKFLOW_RUN_EVENT.TYPE);
  }

  private List<JsonNode> payloads(long issue, String type) {
    return dsl.select(WORKFLOW_RUN_EVENT.PAYLOAD)
        .from(WORKFLOW_RUN_EVENT)
        .join(WORKFLOW_RUN)
        .on(WORKFLOW_RUN.ID.eq(WORKFLOW_RUN_EVENT.RUN_ID))
        .where(WORKFLOW_RUN.ISSUE_ID.eq(issue).and(WORKFLOW_RUN_EVENT.TYPE.eq(type)))
        .orderBy(WORKFLOW_RUN_EVENT.ID)
        .fetch(r -> om.readTree(r.value1().data()));
  }

  /** 그 이슈의 해당 종류 알림을 받은 사람(id 순). */
  private List<Long> recipients(long issue, String type) {
    return dsl.select(NOTIFICATION.RECIPIENT_ID)
        .from(NOTIFICATION)
        .where(NOTIFICATION.ISSUE_ID.eq(issue))
        .and(NOTIFICATION.TYPE.eq(type))
        .orderBy(NOTIFICATION.RECIPIENT_ID)
        .fetch(NOTIFICATION.RECIPIENT_ID);
  }
}
