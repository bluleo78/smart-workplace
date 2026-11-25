package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_VERSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.workflow.repository.NodeRunRow;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1991 「내 차례」({@code GET /me/workflow-turns})와 노드별 진행 중 실행 수({@code GET
 * /workflows/{id}/run-counts})의 계약. 실행·방문 행은 저장소로 직접 심는다(상태·시각을 정확히 정하려고).
 */
@Transactional
class MyWorkflowTurnsApiTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired WorkflowRunRepository runRepository;

  private long pm;
  private long me;
  private long other;
  private String keyA;
  private String keyB;
  private long projectA;
  private long projectB;
  private long wfA;
  private long wfB;

  /** 프로젝트 A·B(TEAM)에 같은 구성원, 각각 정의를 게시한다. 나(me)는 예시 정의의 owner 역할이다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    me = human();
    other = human();
    keyA = newKey();
    keyB = newKey();
    projectA = newProject(keyA);
    projectB = newProject(keyB);
    for (String k : List.of(keyA, keyB)) {
      projectService.addMember(pm, k, new AddMemberRequest(me, "MEMBER"));
      projectService.addMember(pm, k, new AddMemberRequest(other, "MEMBER"));
    }
    wfA = publish(projectA);
    wfB = publish(projectB);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("내 차례는 내가 담당인 활성 사람 노드만, 오래 기다린 순으로 프로젝트를 가로질러 준다")
  void myTurns_onlyMyActiveHumanNodes_oldestFirst_acrossProjects() {
    Instant t1 = Instant.now().minus(3, ChronoUnit.HOURS);
    Instant t2 = Instant.now().minus(2, ChronoUnit.HOURS);
    long runA = seedRun(keyA, wfA, "WAITING", "confirm", me, t2);
    long runB = seedRun(keyB, wfB, "WAITING", "plan_ok", me, t1);
    seedRun(keyA, wfA, "WAITING", "confirm", other, t1.minusSeconds(60));
    seedRun(keyA, wfA, "RUNNING", "dev", me, t1.minusSeconds(120));
    long done = seedRun(keyA, wfA, "WAITING", "confirm", me, t1.minusSeconds(180));
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "COMPLETED")
        .set(WORKFLOW_RUN.ENDED_AT, java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
        .where(WORKFLOW_RUN.ID.eq(done))
        .execute();

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("runId").asLong()).isEqualTo(runB);
    assertThat(items.get(0).get("issueKey").asString())
        .isEqualTo(keyB + "-" + items.get(0).get("issueNumber").asInt());
    assertThat(items.get(0).get("projectKey").asString()).isEqualTo(keyB);
    assertThat(items.get(0).get("workflowName").asString()).startsWith("흐름 ");
    assertThat(items.get(0).get("nodeKey").asString()).isEqualTo("plan_ok");
    assertThat(items.get(0).get("nodeName").asString()).isEqualTo("기획 확정");
    assertThat(items.get(1).get("runId").asLong()).isEqualTo(runA);
    assertThat(items.get(1).get("issueKey").asString())
        .isEqualTo(keyA + "-" + items.get(1).get("issueNumber").asInt());
    assertThat(items.get(1).get("projectKey").asString()).isEqualTo(keyA);
    assertThat(items.get(1).get("nodeKey").asString()).isEqualTo("confirm");
    assertThat(items.get(1).get("nodeName").asString()).isEqualTo("검토");
  }

  @Test
  @DisplayName("앞 노드를 마친 사람은 handedBy, context 의 미답 질문은 question, 없으면 null")
  void myTurns_handedByAndQuestion() {
    Instant t = Instant.now().minus(1, ChronoUnit.HOURS);
    long withBoth = seedRun(keyA, wfA, "WAITING", "dev_ask", me, t, other);
    dsl.update(WORKFLOW_RUN)
        .set(
            WORKFLOW_RUN.CONTEXT,
            org.jooq.JSONB.valueOf(
                "{\"_qa\":[{\"question\":\"배포 언제?\",\"answerNode\":\"dev_ask\",\"answer\":null}]}"))
        .where(WORKFLOW_RUN.ID.eq(withBoth))
        .execute();
    long plain = seedRun(keyB, wfB, "WAITING", "confirm", me, t.plusSeconds(60));

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    assertThat(items).hasSize(2);
    JsonNode first = items.get(0);
    assertThat(first.get("runId").asLong()).isEqualTo(withBoth);
    assertThat(first.get("handedBy").get("username").asString()).isEqualTo(username(other));
    assertThat(first.get("question").asString()).isEqualTo("배포 언제?");
    JsonNode second = items.get(1);
    assertThat(second.get("runId").asLong()).isEqualTo(plain);
    assertThat(second.get("handedBy").isNull()).isTrue();
    assertThat(second.get("question").isNull()).isTrue();
  }

  @Test
  @DisplayName("미답 질문은 _qa 를 뒤에서부터 찾는다 — 마지막이 다른 노드 질문이어도 지금 노드 질문을 주고, 답이 있으면 null")
  void myTurns_questionScansBackwards() {
    Instant t = Instant.now().minus(1, ChronoUnit.HOURS);
    long unanswered = seedRun(keyA, wfA, "WAITING", "dev_ask", me, t);
    setContext(
        unanswered,
        "{\"_qa\":[{\"question\":\"배포 언제?\",\"answerNode\":\"dev_ask\",\"answer\":null},"
            + "{\"question\":\"다른 질문\",\"answerNode\":\"plan_ok\",\"answer\":null}]}");
    long answered = seedRun(keyB, wfB, "WAITING", "dev_ask", me, t.plusSeconds(60));
    setContext(
        answered,
        "{\"_qa\":[{\"question\":\"배포 언제?\",\"answerNode\":\"dev_ask\",\"answer\":\"내일\"}]}");

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("runId").asLong()).isEqualTo(unanswered);
    assertThat(items.get(0).get("question").asString()).isEqualTo("배포 언제?");
    assertThat(items.get(1).get("runId").asLong()).isEqualTo(answered);
    assertThat(items.get(1).get("question").isNull()).isTrue();
  }

  @Test
  @DisplayName("미답 질문 찾기는 깨진 항목 하나(글 아닌 answerNode·객체 아닌 값)에 전체가 null 이 되지 않는다")
  void myTurns_questionSkipsMalformedEntries() {
    long run =
        seedRun(keyA, wfA, "WAITING", "dev_ask", me, Instant.now().minus(1, ChronoUnit.HOURS));
    setContext(
        run,
        "{\"_qa\":[{\"question\":\"살아있는 질문\",\"answerNode\":\"dev_ask\"},"
            + "{\"question\":\"깨짐\",\"answerNode\":{\"x\":1}},42,null]}");

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("question").asString()).isEqualTo("살아있는 질문");
  }

  @Test
  @DisplayName("질문은 앞뒤 빈 줄을 건너뛴 첫 줄만 주고, 질문 경로(returnTo) 노드는 asking=true, 일반 사람 노드는 false")
  void myTurns_askQuestion_firstLineOnly() {
    Instant t = Instant.now().minus(1, ChronoUnit.HOURS);
    long asking = seedRun(keyA, wfA, "WAITING", "dev_ask", me, t);
    setContext(
        asking,
        "{\"_qa\":[{\"question\":\"\\n어느 쪽?\\n- A\\n- B\",\"answerNode\":\"dev_ask\",\"answer\":null}]}");
    long plain = seedRun(keyB, wfB, "WAITING", "confirm", me, t.plusSeconds(60));

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    assertThat(items).hasSize(2);
    assertThat(items.get(0).get("runId").asLong()).isEqualTo(asking);
    assertThat(items.get(0).get("question").asString()).isEqualTo("어느 쪽?");
    assertThat(items.get(0).get("asking").asBoolean()).isTrue();
    assertThat(items.get(1).get("runId").asLong()).isEqualTo(plain);
    assertThat(items.get(1).get("asking").asBoolean()).isFalse();
  }

  @Test
  @DisplayName("질문 첫 줄의 멘션 토큰(<@id>)은 @이름으로 바꿔 준다(WP-2093 설계 §3)")
  void myTurns_questionMentionTokens_shownAsNames() {
    Instant t = Instant.now().minus(1, ChronoUnit.HOURS);
    long asking = seedRun(keyA, wfA, "WAITING", "dev_ask", me, t);
    setContext(
        asking,
        "{\"_qa\":[{\"question\":\"<@"
            + me
            + "> 어느 쪽?\\n- A\",\"answerNode\":\"dev_ask\",\"answer\":null}]}");
    String myName = dsl.select(USER.NAME).from(USER).where(USER.ID.eq(me)).fetchSingle().value1();

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    assertThat(items.get(0).get("question").asString()).isEqualTo("@" + myName + " 어느 쪽?");
  }

  @Test
  @DisplayName("이슈 워크플로우 조회의 currentNode 에 returnTo 가 실린다 — 질문 경로 노드는 돌아갈 노드, 아니면 null")
  void issueWorkflow_currentNodeCarriesReturnTo() {
    Instant t = Instant.now().minus(1, ChronoUnit.HOURS);
    long ask = seedRun(keyA, wfA, "WAITING", "dev_ask", me, t);
    long plain = seedRun(keyB, wfB, "WAITING", "confirm", me, t);

    JsonNode askView = ok(get(API + "/issues/" + issueOf(ask) + "/workflow"), me);
    JsonNode plainView = ok(get(API + "/issues/" + issueOf(plain) + "/workflow"), me);

    assertThat(askView.get("currentNode").get("returnTo").asString()).isEqualTo("dev");
    assertThat(plainView.get("currentNode").get("returnTo").isNull()).isTrue();
  }

  @Test
  @DisplayName("앞쪽에 못 읽는 행이 한 쪽(50)보다 많아도 뒤의 내 차례가 나온다")
  void myTurns_pagesPastManyUnreadableRows() {
    String keyC = newKey();
    long projectC = newProject(keyC);
    long wfC = publish(projectC, spec(pm));
    Instant old = Instant.now().minus(10, ChronoUnit.DAYS);
    for (int i = 0; i < 60; i++) {
      seedRun(keyC, wfC, "WAITING", "confirm", me, old.plusSeconds(i));
    }
    long visible = seedRun(keyA, wfA, "WAITING", "confirm", me, Instant.now());

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("runId").asLong()).isEqualTo(visible);
  }

  @Test
  @DisplayName("진행 중 실행 수는 게시(활성) 버전의 실행만 센다")
  void runCounts_onlyActiveVersion() {
    seedRun(keyA, wfA, "WAITING", "confirm", me, Instant.now());
    dsl.update(com.workplace.jooq.Tables.WORKFLOW)
        .setNull(com.workplace.jooq.Tables.WORKFLOW.ACTIVE_VERSION_ID)
        .where(com.workplace.jooq.Tables.WORKFLOW.ID.eq(wfA))
        .execute();

    JsonNode counts = ok(get(API + "/workflows/" + wfA + "/run-counts"), me).get("counts");

    assertThat(counts.size()).isZero();
  }

  @Test
  @DisplayName("멤버가 아닌 비공개 프로젝트의 실행은 나를 담당에 직접 넣어도 빠진다")
  void myTurns_excludesUnreadableProject() {
    String keyC = newKey();
    long projectC = newProject(keyC);
    long wfC = publish(projectC, spec(pm));
    seedRun(keyC, wfC, "WAITING", "confirm", me, Instant.now().minusSeconds(60));
    long visible = seedRun(keyA, wfA, "WAITING", "confirm", me, Instant.now());

    JsonNode items = ok(get(API + "/me/workflow-turns"), me).get("items");

    // C 의 구성원은 pm 뿐이라 me 는 읽지 못한다.
    assertThat(items).hasSize(1);
    assertThat(items.get(0).get("runId").asLong()).isEqualTo(visible);
  }

  @Test
  @DisplayName("노드별 진행 중 실행 수는 활성만 세고 0 인 노드는 담지 않으며, 못 읽으면 404")
  void runCounts_countsActivePerCurrentNode() {
    Instant t = Instant.now();
    seedRun(keyA, wfA, "WAITING", "confirm", me, t);
    seedRun(keyA, wfA, "WAITING", "confirm", other, t);
    seedRun(keyA, wfA, "RUNNING", "dev", me, t);
    long done = seedRun(keyA, wfA, "WAITING", "plan_ok", me, t);
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "COMPLETED")
        .set(WORKFLOW_RUN.ENDED_AT, java.time.OffsetDateTime.now(java.time.ZoneOffset.UTC))
        .where(WORKFLOW_RUN.ID.eq(done))
        .execute();

    JsonNode counts = ok(get(API + "/workflows/" + wfA + "/run-counts"), me).get("counts");

    assertThat(counts.propertyNames()).containsExactlyInAnyOrder("confirm", "dev");
    assertThat(counts.get("confirm").asInt()).isEqualTo(2);
    assertThat(counts.get("dev").asInt()).isEqualTo(1);

    long stranger = human();
    expect(get(API + "/workflows/" + wfA + "/run-counts"), stranger, 404);
    expect(get(API + "/workflows/" + Long.MAX_VALUE + "/run-counts"), stranger, 404);
  }

  // ───────────────────────── 시험 도우미 ─────────────────────────

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private static String newKey() {
    return "MT" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
  }

  private long newProject(String projectKey) {
    long id =
        projectService.create(pm, new CreateProjectRequest(projectKey, "내 차례", "x", "TEAM")).id();
    TenantContext.set(1L);
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  /** spec-example.yaml 의 owner 를 me, 나머지 구성원을 실제 사용자로 바꾼 글. */
  private String spec() {
    return spec(me);
  }

  /** owner 역할 구성원을 {@code ownerId} 로 둔 정의 글 — 구성원이 프로젝트 멤버여야 게시된다. */
  private String spec(long ownerId) {
    try {
      return Files.readString(
              Path.of("src/test/resources/workflow/spec-example.yaml"), StandardCharsets.UTF_8)
          .replace("teamleader@iacloud.kr", username(pm))
          .replace("planner@iacloud.kr", username(pm))
          .replace("dev1@example.com", username(ownerId == pm ? pm : other))
          .replace("dev2@example.com", username(ownerId == pm ? pm : other))
          .replace("owner@example.com", username(ownerId));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
  }

  /** 프로젝트에 게시하고 켠 정의 id. */
  private long publish(long projectId) {
    return publish(projectId, spec());
  }

  private long publish(long projectId, String yaml) {
    JsonNode created =
        expect(
            post(API + "/projects/" + projectId + "/workflows")
                .content(json("name", "흐름 " + UUID.randomUUID(), "yaml", yaml)),
            pm,
            201);
    long id = created.get("id").asLong();
    expect(post(API + "/workflows/" + id + "/publish"), pm, 200);
    expect(patch(API + "/workflows/" + id).content(json("enabled", true)), pm, 200);
    return id;
  }

  private long issue(String key) {
    JsonNode res =
        expect(post(API + "/projects/" + key + "/issues").content(json("title", "이슈")), pm, 200);
    return res.get("id").asLong();
  }

  private long versionOf(long wf) {
    return dsl.select(WORKFLOW_VERSION.ID)
        .from(WORKFLOW_VERSION)
        .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(wf))
        .orderBy(WORKFLOW_VERSION.VERSION_NO)
        .limit(1)
        .fetchSingle()
        .value1();
  }

  /** 새 이슈에 실행과 {@code assignee} 담당의 활성 방문(노드 {@code node})을 심는다. 실행 id. */
  private long seedRun(
      String key, long wf, String status, String node, long assignee, Instant enteredAt) {
    return seedRun(key, wf, status, node, assignee, enteredAt, null);
  }

  /** {@code handedBy} 가 있으면 그 사람이 마친 앞 방문(review)을 먼저 심는다. */
  private long seedRun(
      String key,
      long wf,
      String status,
      String node,
      long assignee,
      Instant enteredAt,
      Long handedBy) {
    long issue = issue(key);
    long run =
        runRepository
            .insertRun(issue, versionOf(wf), status, node, "{}", pm, enteredAt.minusSeconds(600))
            .orElseThrow()
            .id();
    if (handedBy != null) {
      NodeRunRow prev =
          runRepository.insertNodeRun(
              run, "dev", 1, "ACTIVE", List.of(), List.of(), false, enteredAt.minusSeconds(300));
      runRepository.completeNodeRun(
          prev.id(), "COMPLETED", "ask", null, null, null, handedBy, enteredAt);
    }
    runRepository.insertNodeRun(
        run, node, 1, "ACTIVE", List.of(assignee), List.of(), false, enteredAt);
    return run;
  }

  /** 실행이 걸린 이슈 id. */
  private long issueOf(long run) {
    return dsl.select(WORKFLOW_RUN.ISSUE_ID)
        .from(WORKFLOW_RUN)
        .where(WORKFLOW_RUN.ID.eq(run))
        .fetchSingle()
        .value1();
  }

  /** 실행의 context JSON 을 직접 바꾼다. */
  private void setContext(long run, String contextJson) {
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.CONTEXT, org.jooq.JSONB.valueOf(contextJson))
        .where(WORKFLOW_RUN.ID.eq(run))
        .execute();
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
    long tenant = TenantContext.get();
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      assertThat(response.getStatus()).as("%s", text).isEqualTo(status);
      return text.isBlank() ? null : om.readTree(text);
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(tenant);
    }
  }
}
