package com.workplace.issue.workflow;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WORKFLOW_RUN;
import static com.workplace.jooq.Tables.WORKFLOW_VERSION;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.service.IssueTypeService;
import com.workplace.issue.service.OpenScenario;
import com.workplace.issue.workflow.repository.WorkflowRepository;
import com.workplace.issue.workflow.repository.WorkflowRunRepository;
import com.workplace.project.dto.AddMemberRequest;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectIssueSequenceRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.repository.UserRepository;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1985 워크플로우 실행 목록({@code GET /workflows/{id}/runs})·상세({@code GET /workflow-runs/{runId}})의 계약
 * — 거르기·최신순 cursor·잘못된 값 400·삭제 이슈 숨김·옛 버전 모델·읽기 권한과 테넌트 경계. 요청은 시험 트랜잭션에 합류하고 끝나면 롤백된다.
 *
 * <p>실행은 실제 시작·이동 API 로 만들고, API 로 만들 수 없는 상태(CANCELED 등)만 행을 직접 고친다.
 */
@Transactional
class WorkflowRunQueryApiTest extends IntegrationTestBase {

  private static final String API = "/api/v1";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired ProjectService projectService;
  @Autowired IssueTypeService issueTypeService;
  @Autowired IssueRepository issueRepository;
  @Autowired ProjectIssueSequenceRepository sequenceRepository;
  @Autowired WorkflowRepository workflowRepository;
  @Autowired WorkflowRunRepository runRepository;
  @Autowired UserRepository userRepository;

  /** 프로젝트 OWNER(관리자) — 역할에는 들지 않는다. */
  private long pm;

  private long lead;
  private long planner;
  private long dev1;
  private long dev2;
  private long owner;
  private String key;
  private long projectId;

  /** 예시 정의의 다섯 구성원과 관리자가 있는 TEAM 프로젝트(TEAM 이라 비구성원은 읽지 못한다). */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    pm = human();
    lead = human();
    planner = human();
    dev1 = human();
    dev2 = human();
    owner = human();
    key = newKey();
    projectId = newProject(key, pm);
    for (long id : List.of(lead, planner, dev1, dev2, owner)) {
      projectService.addMember(pm, key, new AddMemberRequest(id, "MEMBER"));
    }
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  // ───────────────────────── 목록 ─────────────────────────

  @Test
  @DisplayName("목록은 status·node·assigneeId(지금 노드의 담당)로 거르고, 여러 조건은 모두 맞아야 한다")
  void runs_filterByStatusNodeAssignee() {
    long wf = publish(spec());
    // a: triage(lead), b: triage → dev(dev1, 앞 노드 담당 lead), c: dev(dev2), d: triage 였다가 CANCELED
    long a = issue(lead);
    long runA = ok(startReq(a, wf), lead).get("runId").asLong();
    long b = issue(lead);
    long runB = ok(startReq(b, wf), lead).get("runId").asLong();
    ok(moveReq(b, "triage", "ready", List.of(dev1), 0, "k1"), lead);
    long c = issue(dev2);
    long runC = ok(startReq(c, wf), dev2).get("runId").asLong();
    long d = issue(lead);
    long runD = ok(startReq(d, wf), lead).get("runId").asLong();
    dsl.update(WORKFLOW_RUN)
        .set(WORKFLOW_RUN.STATUS, "CANCELED")
        .set(WORKFLOW_RUN.ENDED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(WORKFLOW_RUN.ID.eq(runD))
        .execute();

    JsonNode all = ok(get(runsPath(wf)), dev2);
    assertThat(runIds(all.get("items"))).containsExactly(runD, runC, runB, runA);
    assertThat(all.get("nextCursor").isNull()).isTrue();

    // 항목 모양(설계 §11)
    JsonNode itemB = all.get("items").get(2);
    assertThat(fieldsOf(itemB))
        .containsExactlyInAnyOrder(
            "runId",
            "issueId",
            "issueKey",
            "title",
            "status",
            "currentNode",
            "currentNodeName",
            "assignees",
            "enteredAt",
            "startedAt",
            "versionNo");
    assertThat(itemB.get("issueId").asLong()).isEqualTo(b);
    assertThat(itemB.get("issueKey").asString()).isEqualTo(key + "-" + number(b));
    assertThat(itemB.get("title").asString()).isEqualTo("이슈");
    assertThat(itemB.get("status").asString()).isEqualTo("RUNNING");
    assertThat(itemB.get("currentNode").asString()).isEqualTo("dev");
    assertThat(itemB.get("currentNodeName").asString()).isEqualTo("개발");
    assertThat(ids(itemB.get("assignees"))).containsExactly(dev1);
    assertThat(itemB.get("assignees").get(0).get("username").asString()).isEqualTo(username(dev1));
    assertThat(Instant.parse(itemB.get("enteredAt").asString()))
        .isAfterOrEqualTo(Instant.parse(itemB.get("startedAt").asString()));
    assertThat(itemB.get("versionNo").asInt()).isEqualTo(1);

    assertThat(runIds(ok(get(runsPath(wf) + "?status=CANCELED"), dev2).get("items")))
        .containsExactly(runD);
    assertThat(runIds(ok(get(runsPath(wf) + "?status=RUNNING"), dev2).get("items")))
        .containsExactly(runC, runB, runA);
    assertThat(runIds(ok(get(runsPath(wf) + "?node=triage"), dev2).get("items")))
        .containsExactly(runD, runA);
    // 앞 노드(triage)의 담당이던 lead 는 b 에 걸리지 않는다 — 지금 노드의 담당만 본다.
    assertThat(runIds(ok(get(runsPath(wf) + "?assigneeId=" + lead), dev2).get("items")))
        .containsExactly(runD, runA);
    assertThat(runIds(ok(get(runsPath(wf) + "?assigneeId=" + dev1), dev2).get("items")))
        .containsExactly(runB);
    assertThat(
            runIds(
                ok(get(runsPath(wf) + "?status=RUNNING&node=triage&assigneeId=" + lead), dev2)
                    .get("items")))
        .containsExactly(runA);
    assertThat(ok(get(runsPath(wf) + "?status=COMPLETED&node=triage"), dev2).get("items").isEmpty())
        .isTrue();
  }

  @Test
  @DisplayName("31건을 최신순으로 넘기면 겹침·빠짐이 없고 마지막 쪽의 nextCursor 는 null, 사용자 조회는 쪽마다 한 번")
  void runs_newestFirst_cursorNoDupNoGap() {
    long wf = publish(spec());
    List<Long> made = new ArrayList<>();
    for (int i = 0; i < 31; i++) {
      long issue = issue(i % 2 == 0 ? lead : dev1);
      made.add(ok(startReq(issue, wf), i % 2 == 0 ? lead : dev1).get("runId").asLong());
    }
    List<Long> newestFirst = new ArrayList<>(made);
    newestFirst.sort((x, y) -> Long.compare(y, x));

    // 기본 크기 30: 30 + 1
    JsonNode first = ok(get(runsPath(wf)), dev2);
    assertThat(first.get("items")).hasSize(30);
    assertThat(first.get("nextCursor").isNull()).isFalse();
    JsonNode second = ok(get(runsPath(wf) + "?cursor=" + first.get("nextCursor").asString()), dev2);
    assertThat(second.get("items")).hasSize(1);
    assertThat(second.get("nextCursor").isNull()).isTrue();
    List<Long> byDefault = new ArrayList<>(runIds(first.get("items")));
    byDefault.addAll(runIds(second.get("items")));
    assertThat(byDefault).containsExactlyElementsOf(newestFirst);

    // 크기 10: 10·10·10·1, 사용자 요약은 쪽마다 한 번만 읽는다
    List<Long> paged = new ArrayList<>();
    String cursor = null;
    int pages = 0;
    do {
      clearInvocations(userRepository);
      String q = runsPath(wf) + "?size=10" + (cursor == null ? "" : "&cursor=" + cursor);
      JsonNode page = ok(get(q), dev2);
      verify(userRepository, times(1)).findAssigneeInfos(any(), eq(1L));
      assertThat(page.get("items").size()).isLessThanOrEqualTo(10);
      paged.addAll(runIds(page.get("items")));
      cursor = page.get("nextCursor").isNull() ? null : page.get("nextCursor").asString();
      pages++;
    } while (cursor != null);
    assertThat(pages).isEqualTo(4);
    assertThat(paged).containsExactlyElementsOf(newestFirst);
  }

  @Test
  @DisplayName("모르는 status·깨진 cursor·범위 밖 size 는 400 과 errors.code")
  void runs_badStatusOrCursor_400() {
    long wf = publish(spec());
    ok(startReq(issue(lead), wf), lead);

    assertCode(
        expect(get(runsPath(wf) + "?status=DONE"), dev2, 400), "WORKFLOW_INVALID_RUN_STATUS");
    assertCode(
        expect(get(runsPath(wf) + "?status=running"), dev2, 400), "WORKFLOW_INVALID_RUN_STATUS");
    // r0 · r-1 · r+1 · r+20자리(long 넘침) 를 base64url 로 인코딩한 cursor — 숫자·0 이하·넘침 분기
    for (String bad :
        List.of(
            "abc!",
            "Zm9v",
            "LTE",
            "MA",
            "",
            "%20",
            "cjA",
            "ci0x",
            "cisx",
            "cjk5OTk5OTk5OTk5OTk5OTk5OTk5")) {
      assertCode(
          expect(get(runsPath(wf) + "?cursor=" + bad), dev2, 400), "WORKFLOW_INVALID_CURSOR");
    }
    for (String size : List.of("0", "101", "-1")) {
      assertCode(
          expect(get(runsPath(wf) + "?size=" + size), dev2, 400), "WORKFLOW_INVALID_PAGE_SIZE");
    }
    assertThat(ok(get(runsPath(wf) + "?size=100"), dev2).get("items")).hasSize(1);
  }

  @Test
  @DisplayName("삭제된 이슈의 실행은 목록에서 빠지고 상세는 404")
  void runs_hidesDeletedIssue() {
    long wf = publish(spec());
    long kept = issue(lead);
    long keptRun = ok(startReq(kept, wf), lead).get("runId").asLong();
    long gone = issue(lead);
    long goneRun = ok(startReq(gone, wf), lead).get("runId").asLong();
    assertThat(runIds(ok(get(runsPath(wf)), dev2).get("items"))).containsExactly(goneRun, keptRun);

    dsl.update(ISSUE)
        .set(ISSUE.DELETED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(ISSUE.ID.eq(gone))
        .execute();

    assertThat(runIds(ok(get(runsPath(wf)), dev2).get("items"))).containsExactly(keptRun);
    assertThat(runIds(ok(get(runsPath(wf) + "?status=RUNNING"), dev2).get("items")))
        .containsExactly(keptRun);
    assertCode(expect(get(runPath(goneRun)), dev2, 404), "WORKFLOW_NOT_FOUND");
    ok(get(runPath(keptRun)), dev2);
  }

  @Test
  @DisplayName("못 보는 프로젝트의 워크플로우 목록은 없는 워크플로우와 같은 404")
  void runs_unreadableProject_404() {
    long wf = publish(spec());
    ok(startReq(issue(lead), wf), lead);
    long stranger = human();
    JsonNode hidden = expect(get(runsPath(wf)), stranger, 404);
    JsonNode missing = expect(get(runsPath(Long.MAX_VALUE)), stranger, 404);
    assertCode(hidden, "WORKFLOW_NOT_FOUND");
    assertThat(hidden.get("message")).isEqualTo(missing.get("message"));
    assertThat(hidden.toString()).doesNotContain("triage");
  }

  // ───────────────────────── 상세 ─────────────────────────

  @Test
  @DisplayName("옛 버전 실행의 상세 model 은 그 버전 조회의 model 과 같다(새 버전 것이 아니다)")
  void runDetail_modelMatchesVersionEndpoint() {
    long wf = publish(spec());
    long issue = issue(lead);
    long runId = ok(startReq(issue, wf), lead).get("runId").asLong();
    ok(moveReq(issue, "triage", "ready", List.of(dev1), 0, "k1"), lead);
    ok(
        put(API + "/workflows/" + wf + "/draft")
            .content(json("yaml", spec().replace("triage", "sorting"))),
        pm);
    ok(post(API + "/workflows/" + wf + "/publish"), pm);

    JsonNode detail = ok(get(runPath(runId)), dev2);

    assertThat(fieldsOf(detail)).containsExactlyInAnyOrder("run", "nodeRuns", "events", "model");
    JsonNode v1 = ok(get(API + "/workflows/" + wf + "/versions/1"), dev2).get("model");
    JsonNode v2 = ok(get(API + "/workflows/" + wf + "/versions/2"), dev2).get("model");
    assertThat(detail.get("model")).isEqualTo(v1);
    assertThat(detail.get("model")).isNotEqualTo(v2);

    JsonNode run = detail.get("run");
    assertThat(run.get("runId").asLong()).isEqualTo(runId);
    assertThat(run.get("workflowId").asLong()).isEqualTo(wf);
    assertThat(run.get("versionNo").asInt()).isEqualTo(1);
    assertThat(run.get("status").asString()).isEqualTo("RUNNING");
    assertThat(run.get("revision").asInt()).isEqualTo(1);
    assertThat(run.get("currentNode").asString()).isEqualTo("dev");
    assertThat(run.get("issueKey").asString()).isEqualTo(key + "-" + number(issue));
    assertThat(run.get("startedBy").get("id").asLong()).isEqualTo(lead);
    assertThat(run.get("endedAt").isNull()).isTrue();

    // 방문은 들어간 순서: start → triage → dev
    List<String> visits = new ArrayList<>();
    detail.get("nodeRuns").forEach(r -> visits.add(r.get("nodeKey").asString()));
    assertThat(visits).containsExactly("start", "triage", "dev");
    JsonNode triage = detail.get("nodeRuns").get(1);
    assertThat(triage.get("nodeName").asString()).isEqualTo("분류");
    assertThat(triage.get("outcome").asString()).isEqualTo("ready");
    assertThat(triage.get("status").asString()).isEqualTo("COMPLETED");
    assertThat(triage.get("actor").get("id").asLong()).isEqualTo(lead);
    assertThat(ids(triage.get("assignees"))).containsExactly(lead);
    assertThat(ids(detail.get("nodeRuns").get(2).get("assignees"))).containsExactly(dev1);

    List<String> types = new ArrayList<>();
    detail.get("events").forEach(e -> types.add(e.get("type").asString()));
    assertThat(types).containsExactly("RUN_STARTED", "MOVED");
    JsonNode moved = detail.get("events").get(1);
    assertThat(moved.get("payload").get("to").asString()).isEqualTo("dev");
    assertThat(moved.get("actor").get("id").asLong()).isEqualTo(lead);
  }

  @Test
  @DisplayName("못 보는 프로젝트의 실행 상세는 없는 실행과 같은 404(구성원은 200)")
  void runDetail_unreadableProject_404() {
    long wf = publish(spec());
    long runId = ok(startReq(issue(lead), wf), lead).get("runId").asLong();
    ok(get(runPath(runId)), dev2);

    long stranger = human();
    JsonNode hidden = expect(get(runPath(runId)), stranger, 404);
    JsonNode missing = expect(get(runPath(Long.MAX_VALUE)), stranger, 404);
    assertCode(hidden, "WORKFLOW_NOT_FOUND");
    assertThat(hidden.get("message")).isEqualTo(missing.get("message"));
    assertThat(hidden.get("errors")).isEqualTo(missing.get("errors"));
    assertThat(hidden.toString()).doesNotContain("triage").doesNotContain("nodeRuns");
  }

  @Test
  @DisplayName("다른 테넌트의 실행 id 는 404 — OPEN 프로젝트라 같은 테넌트였다면 보였을 실행이다")
  void runDetail_otherTenant_404() {
    // 같은 테넌트의 OPEN 프로젝트 실행은 비구성원도 본다(대조군) — 그래서 아래 404 는 RLS 만이 낸다.
    var mine = OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, 1L);
    TenantContext.set(1L);
    String stored = storedModel(publish(spec()));
    long myRun = seedRun(mine.project().id(), mine.issueId(), stored, mine.ownerId());
    ok(get(runPath(myRun)), pm);

    long tid2 = ensureFixtureTenant("wf-run-query-rls");
    useTenant(tid2);
    var other =
        OpenScenario.create(dsl, issueTypeService, issueRepository, sequenceRepository, tid2);
    useTenant(tid2);
    long otherRun = seedRun(other.project().id(), other.issueId(), stored, other.ownerId());
    useTenant(1L);

    JsonNode hidden = expect(get(runPath(otherRun)), pm, 404);
    assertCode(hidden, "WORKFLOW_NOT_FOUND");
    assertThat(hidden.toString()).doesNotContain("triage").doesNotContain("model");

    useTenant(tid2);
    assertThat(runRepository.findRun(otherRun)).isPresent();
    useTenant(1L);
  }

  // ───────────────────────── 시험 도우미 ─────────────────────────

  private record Res(int status, String text, JsonNode body) {}

  private long human() {
    long id = withMembership(TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, id, "USER");
    return id;
  }

  private static String newKey() {
    return "WQ" + UUID.randomUUID().toString().replace("-", "").substring(0, 7).toUpperCase();
  }

  private long newProject(String projectKey, long ownerId) {
    long id =
        projectService
            .create(ownerId, new CreateProjectRequest(projectKey, "실행 조회", "x", "TEAM"))
            .id();
    TenantContext.set(1L);
    return id;
  }

  private String username(long userId) {
    return dsl.select(USER.USERNAME).from(USER).where(USER.ID.eq(userId)).fetchSingle().value1();
  }

  /** spec-example.yaml 의 구성원을 실제 사용자로 바꾼 글. */
  private String spec() {
    try {
      return Files.readString(
              Path.of("src/test/resources/workflow/spec-example.yaml"), StandardCharsets.UTF_8)
          .replace("teamleader@iacloud.kr", username(lead))
          .replace("planner@iacloud.kr", username(planner))
          .replace("dev1@example.com", username(dev1))
          .replace("dev2@example.com", username(dev2))
          .replace("owner@example.com", username(owner));
    } catch (IOException e) {
      throw new IllegalStateException(e);
    }
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

  /** 정의의 v1 저장 모델 JSON 글. */
  private String storedModel(long wf) {
    return dsl.select(WORKFLOW_VERSION.MODEL)
        .from(WORKFLOW_VERSION)
        .where(WORKFLOW_VERSION.WORKFLOW_ID.eq(wf))
        .orderBy(WORKFLOW_VERSION.VERSION_NO)
        .limit(1)
        .fetchSingle()
        .value1()
        .data();
  }

  /** 지금 테넌트의 프로젝트에 정의·버전·실행 행을 직접 심는다(실행 id). */
  private long seedRun(long project, long issue, String modelJson, long actor) {
    long wf = workflowRepository.insert(project, "심은 흐름", "a", actor, Instant.now());
    long version = workflowRepository.insertVersion(wf, "a", modelJson, actor).id();
    return runRepository
        .insertRun(issue, version, "RUNNING", "triage", "{}", actor, Instant.now())
        .orElseThrow()
        .id();
  }

  /** 관리자가 담당을 넣어 만든 이슈 id(제목 「이슈」). */
  private long issue(long... assignees) {
    List<Long> ids = new ArrayList<>();
    for (long a : assignees) {
      ids.add(a);
    }
    Res res =
        send(
            post(API + "/projects/" + key + "/issues")
                .content(json("title", "이슈", "assigneeIds", ids)),
            pm);
    assertThat(res.status()).as("%s", res.text()).isBetween(200, 201);
    return res.body().get("id").asLong();
  }

  private int number(long issue) {
    return dsl.select(ISSUE.NUMBER).from(ISSUE).where(ISSUE.ID.eq(issue)).fetchSingle().value1();
  }

  private MockHttpServletRequestBuilder startReq(long issue, long wf) {
    return post(API + "/issues/" + issue + "/workflow/start")
        .content(json("workflowId", wf, "dryRun", false));
  }

  private MockHttpServletRequestBuilder moveReq(
      long issue, String from, String outcome, List<Long> assigneeIds, int revision, String k) {
    Map<String, Object> body = new LinkedHashMap<>();
    body.put("fromNode", from);
    body.put("outcome", outcome);
    body.put("assigneeIds", assigneeIds);
    body.put("expectedRevision", revision);
    body.put("idempotencyKey", k);
    return post(API + "/issues/" + issue + "/workflow/move").content(om.writeValueAsString(body));
  }

  private static String runsPath(long wf) {
    return API + "/workflows/" + wf + "/runs";
  }

  private static String runPath(long runId) {
    return API + "/workflow-runs/" + runId;
  }

  private String json(Object... pairs) {
    Map<String, Object> map = new LinkedHashMap<>();
    for (int i = 0; i < pairs.length; i += 2) {
      map.put((String) pairs[i], pairs[i + 1]);
    }
    return om.writeValueAsString(map);
  }

  private static List<Long> runIds(JsonNode items) {
    List<Long> out = new ArrayList<>();
    items.forEach(i -> out.add(i.get("runId").asLong()));
    return out;
  }

  private static List<Long> ids(JsonNode users) {
    List<Long> out = new ArrayList<>();
    users.forEach(u -> out.add(u.get("id").asLong()));
    return out;
  }

  private static List<String> fieldsOf(JsonNode node) {
    List<String> out = new ArrayList<>();
    node.propertyNames().forEach(out::add);
    return out;
  }

  private static void assertCode(JsonNode body, String code) {
    assertThat(body.get("errors").get("code").asString()).as("%s", body).isEqualTo(code);
  }

  private JsonNode ok(MockHttpServletRequestBuilder req, long caller) {
    return expect(req, caller, 200);
  }

  private JsonNode expect(MockHttpServletRequestBuilder req, long caller, int status) {
    Res res = send(req, caller);
    assertThat(res.status()).as("%s", res.text()).isEqualTo(status);
    return res.body();
  }

  private Res send(MockHttpServletRequestBuilder req, long caller) {
    req.contentType(MediaType.APPLICATION_JSON);
    req.header("Authorization", "Bearer " + jwt.generateAccessToken(caller, "u-" + caller, 1L));
    long tenant = TenantContext.get();
    try {
      var response = mvc.perform(req).andReturn().getResponse();
      String text = response.getContentAsString(StandardCharsets.UTF_8);
      return new Res(response.getStatus(), text, text.isBlank() ? null : om.readTree(text));
    } catch (Exception e) {
      throw new IllegalStateException("요청 실패", e);
    } finally {
      TenantContext.set(tenant);
    }
  }
}
