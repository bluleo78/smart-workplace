package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 위임 작업 목록·건수 API(WP-377 §5.2) — GET /api/v1/me/ai-tasks, /counts. 실 JWT + MockMvc 로 범위(나와
 * 관련·전체)·급한 순 정렬·상태 필터·복합 커서 페이지 경계·건수를 검증한다. 테스트 트랜잭션 안에서 시드하고 롤백한다.
 */
@Transactional
class AiTasksControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueRepository issueRepository;

  /** 호출자(사람). */
  private long me;

  /** 같은 프로젝트의 다른 사람. */
  private long other;

  /** AI 구성원. */
  private long agent;

  /** 호출자가 소유한(=멤버인) 프로젝트. */
  private long projectId;

  /** 다음 이슈 번호. */
  private int nextNumber = 1;

  @BeforeEach
  void seedUsersAndProject() {
    me = createUser("ai-me");
    other = createUser("ai-ot");
    agent = createAgentUser("ai-agent");
    var project = projectService.create(me, new CreateProjectRequest(uniqueKey("AT"), "P-ai", "x"));
    projectId = project.id();
    projectMemberRepository.insert(projectId, other, "MEMBER");
  }

  // ---------------------------------------------------------------- 범위

  @Test
  void MINE_은_내가_만든_AI담당_이슈와_내가_AI도구로_작업중인_이슈() throws Exception {
    long a = issue("a", me);
    assign(a, agent);
    long b = issue("b", other);
    work(b, me, "WORKING");
    long c = issue("c", other);
    assign(c, agent);
    long d = issue("d", me);
    assign(d, me);
    long e = issue("e", other);
    work(e, other, "WORKING");
    // 내 작업이 이미 끝난 이슈는 진행 중이 아니므로 빠진다.
    long f = issue("f", other);
    work(f, me, "WORKING");
    endWork(f);

    assertThat(titles(getJson("/api/v1/me/ai-tasks"))).containsExactlyInAnyOrder("a", "b");
  }

  @Test
  void ALL_은_접근가능한_모든_AI_이슈_접근불가_프로젝트_제외() throws Exception {
    long a = issue("a", me);
    assign(a, agent);
    long b = issue("b", other);
    work(b, me, "WORKING");
    long c = issue("c", other);
    assign(c, agent);
    long d = issue("d", me);
    assign(d, me);
    long e = issue("e", other);
    work(e, other, "WORKING");
    // 호출자가 멤버가 아닌 프로젝트 — AI 담당·사람 작업이 있어도 보이지 않아야 한다.
    var priv =
        projectService.create(other, new CreateProjectRequest(uniqueKey("PV"), "P-priv", "x"));
    var x = issueRepository.insert(priv.id(), 1, "priv-x", null, "MID", null, other);
    assign(x.id(), agent);
    var y = issueRepository.insert(priv.id(), 2, "priv-y", null, "MID", null, other);
    work(y.id(), other, "WAITING");

    assertThat(titles(getJson("/api/v1/me/ai-tasks?scope=all")))
        .containsExactlyInAnyOrder("a", "b", "c", "e");
  }

  // ---------------------------------------------------------------- 정렬·필터

  @Test
  void 급한순_정렬_답변필요_검토필요_막힘_작업중_일시중지_작업없음() throws Exception {
    // 일부러 급한 순과 다른 순서로 만든다.
    long none = issue("none", me);
    assign(none, agent);
    work(issue("paused", other), me, "PAUSED");
    work(issue("working", other), me, "WORKING");
    work(issue("blocked", other), me, "BLOCKED");
    work(issue("review", other), me, "REVIEW");
    work(issue("waiting", other), me, "WAITING");

    var items = getJson("/api/v1/me/ai-tasks").get("items");
    List<String> states = new ArrayList<>();
    items.forEach(
        it -> states.add(it.has("agentWork") ? it.at("/agentWork/0/state").asText() : null));
    assertThat(states).containsExactly("WAITING", "REVIEW", "BLOCKED", "WORKING", "PAUSED", null);
  }

  @Test
  void 같은_순위는_마지막_보고_최근순_작업없는_이슈는_이슈_수정시각_최근순() throws Exception {
    long older = issue("older", other);
    work(older, me, "WORKING", Instant.parse("2026-10-01T00:00:00Z"));
    long newer = issue("newer", other);
    work(newer, me, "WORKING", Instant.parse("2026-10-02T00:00:00Z"));
    // 한 이슈에 여러 작업이면 가장 급한 상태가 순위 — AI 구성원 WAITING 이 사람 WORKING 보다 앞선다.
    long mixed = issue("mixed", me);
    assign(mixed, agent);
    work(mixed, me, "WORKING");
    work(mixed, agent, "WAITING");
    long idleOld = issue("idle-old", me);
    assign(idleOld, agent);
    long idleNew = issue("idle-new", me);
    assign(idleNew, agent);
    setIssueUpdatedAt(idleOld, Instant.parse("2026-09-01T00:00:00Z"));
    setIssueUpdatedAt(idleNew, Instant.parse("2026-09-02T00:00:00Z"));

    assertThat(titles(getJson("/api/v1/me/ai-tasks")))
        .containsExactly("mixed", "newer", "older", "idle-new", "idle-old");
  }

  @Test
  void agentState_필터는_진행중_작업_상태로_거르고_모르는_값은_무시() throws Exception {
    work(issue("waiting", other), me, "WAITING");
    work(issue("review", other), me, "REVIEW");
    work(issue("working", other), me, "WORKING");
    long none = issue("none", me);
    assign(none, agent);

    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=WAITING, REVIEW")))
        .containsExactlyInAnyOrder("waiting", "review");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=NOPE")))
        .containsExactlyInAnyOrder("waiting", "review", "working", "none");
  }

  @Test
  void status_priority_필터() throws Exception {
    long todo = issue("todo", other);
    work(todo, me, "WORKING");
    long doing = issue("doing", other);
    work(doing, me, "WORKING");
    setStatus(doing, "IN_PROGRESS");
    dsl.update(ISSUE).set(ISSUE.PRIORITY, "HIGH").where(ISSUE.ID.eq(todo)).execute();

    assertThat(titles(getJson("/api/v1/me/ai-tasks?status=IN_PROGRESS"))).containsExactly("doing");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?priority=HIGH"))).containsExactly("todo");
  }

  // ---------------------------------------------------------------- 커서

  @Test
  void 페이지_경계에서_중복_누락_없음() throws Exception {
    // 앞쪽 3행: 진행 중 작업이 있어 순위가 앞선다(첫 경계에서 rank > r 분기를 탄다).
    work(issue("w1", other), me, "WAITING");
    work(issue("r1", other), me, "REVIEW");
    work(issue("k1", other), me, "WORKING");
    // 뒤쪽 5행: 작업 없는 AI 담당 — 같은 순위·같은 정렬 시각(마이크로초 포함). 두 번째 경계가 이들 사이를 자른다(id 동률 깨기).
    List<Long> tied = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      long t = issue("t" + i, me);
      assign(t, agent);
      tied.add(t);
    }
    // 시드가 모두 끝난 뒤 시각을 고정한다 — 앞선 시드가 updated_at 을 건드려도 동률이 유지되도록.
    Instant same = Instant.parse("2026-10-14T01:02:03.123456Z");
    tied.forEach(t -> setIssueUpdatedAt(t, same));

    List<String> expected = titles(getJson("/api/v1/me/ai-tasks?scope=ALL&size=100"));
    assertThat(expected).hasSize(8);

    List<String> seen = new ArrayList<>();
    String cursor = null;
    int pages = 0;
    do {
      var page =
          getJson(
              "/api/v1/me/ai-tasks?scope=ALL&size=3" + (cursor == null ? "" : "&cursor=" + cursor));
      seen.addAll(titles(page));
      cursor = page.get("hasMore").asBoolean() ? page.get("nextCursor").asText() : null;
      assertThat(++pages).as("페이지 순회가 끝나지 않는다").isLessThan(10);
    } while (cursor != null);

    assertThat(seen).doesNotHaveDuplicates().containsExactlyElementsOf(expected);
  }

  @Test
  void 잘못된_커서_400() throws Exception {
    assertThat(status("/api/v1/me/ai-tasks?cursor=zzz")).isEqualTo(400);
    // base64 로는 맞지만 형식이 다른 커서(기존 이슈 커서 모양)도 400.
    String issueCursorLike =
        java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("123:45".getBytes());
    assertThat(status("/api/v1/me/ai-tasks?cursor=" + issueCursorLike)).isEqualTo(400);
  }

  // ---------------------------------------------------------------- 건수·응답

  @Test
  void counts_는_범위와_이슈상태_필터를_따르고_agentState_는_무시() throws Exception {
    work(issue("waiting", other), me, "WAITING");
    work(issue("review", other), me, "REVIEW");
    work(issue("blocked", other), me, "BLOCKED");
    long working = issue("working", other);
    work(working, me, "WORKING");
    setStatus(working, "IN_PROGRESS");
    // 남의 작업 — MINE 건수에서는 빠지고 ALL 에서는 잡힌다.
    work(issue("others", other), other, "WAITING");

    assertThat(counts("/api/v1/me/ai-tasks/counts?agentState=WAITING"))
        .isEqualTo(Map.of("all", 4, "waiting", 1, "review", 1, "blocked", 1, "working", 1));
    assertThat(counts("/api/v1/me/ai-tasks/counts?scope=ALL"))
        .isEqualTo(Map.of("all", 5, "waiting", 2, "review", 1, "blocked", 1, "working", 1));
    assertThat(counts("/api/v1/me/ai-tasks/counts?status=IN_PROGRESS"))
        .isEqualTo(Map.of("all", 1, "waiting", 0, "review", 0, "blocked", 0, "working", 1));
  }

  @Test
  void 종료된_이슈에_남은_진행중_행은_순위_건수_범위에_반영되지_않는다() throws Exception {
    // AI 담당 + 고아 WAITING 행이 남은 DONE 이슈 — 목록에는 남되 작업 기반 순위·건수는 0.
    long closed = issue("closed", me);
    assign(closed, agent);
    work(closed, agent, "WAITING");
    setStatus(closed, "DONE");
    setIssueUpdatedAt(closed, Instant.parse("2026-09-01T00:00:00Z"));
    long open = issue("open", me);
    assign(open, agent);
    setIssueUpdatedAt(open, Instant.parse("2026-09-02T00:00:00Z"));
    // 사람 고아 행만 있는 DONE 이슈 — 내 작업(ASSISTED)으로 MINE 에 들어오면 안 된다.
    long humanOrphan = issue("human-orphan", other);
    work(humanOrphan, me, "WORKING");
    setStatus(humanOrphan, "DONE");

    // 고아 WAITING 이 순위 0 이면 closed 가 앞서지만, 작업 없음으로 취급되어 최근 수정순(open 먼저).
    assertThat(titles(getJson("/api/v1/me/ai-tasks"))).containsExactly("open", "closed");
    assertThat(titles(getJson("/api/v1/me/ai-tasks?agentState=WAITING"))).isEmpty();
    assertThat(counts("/api/v1/me/ai-tasks/counts"))
        .isEqualTo(Map.of("all", 2, "waiting", 0, "review", 0, "blocked", 0, "working", 0));
  }

  @Test
  void 응답_항목에_agentWork_와_projectKey_포함() throws Exception {
    long b = issue("b", other);
    work(b, me, "REVIEW");

    var item = getJson("/api/v1/me/ai-tasks").get("items").get(0);
    assertThat(item.get("projectKey").asText()).startsWith("AT");
    assertThat(item.at("/agentWork/0/state").asText()).isEqualTo("REVIEW");
    assertThat(item.at("/agentWork/0/tool").asText()).isEqualTo("claude-code");
    assertThat(item.at("/agentWork/0/worker/kind").asText()).isEqualTo("HUMAN");
  }

  // ---------------------------------------------------------------- helpers

  /** USER 역할이 부여된 사람 사용자 시드. */
  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private static String uniqueKey(String prefix) {
    return prefix + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
  }

  /** 호출자 프로젝트에 이슈를 만든다(제목으로 식별). */
  private long issue(String title, long reporter) {
    return issueRepository.insert(projectId, nextNumber++, title, null, "MID", null, reporter).id();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, me)
        .execute();
  }

  private void work(long issueId, long workerId, String state) {
    work(issueId, workerId, state, Instant.parse("2026-10-10T00:00:00Z"));
  }

  /** 진행 중 작업 시드 — 마지막 보고 시각을 지정한다. */
  private void work(long issueId, long workerId, String state, Instant updatedAt) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, state)
        .set(AGENT_WORK.UPDATED_AT, updatedAt.atOffset(ZoneOffset.UTC))
        .execute();
  }

  private void endWork(long issueId) {
    dsl.update(AGENT_WORK)
        .set(AGENT_WORK.ENDED_AT, OffsetDateTime.now())
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .execute();
  }

  private void setIssueUpdatedAt(long issueId, Instant at) {
    dsl.update(ISSUE)
        .set(ISSUE.UPDATED_AT, at.atOffset(ZoneOffset.UTC))
        .where(ISSUE.ID.eq(issueId))
        .execute();
  }

  private void setStatus(long issueId, String status) {
    dsl.update(ISSUE).set(ISSUE.STATUS, status).where(ISSUE.ID.eq(issueId)).execute();
  }

  private MvcResult perform(String url) throws Exception {
    return mvc.perform(
            get(url)
                .header(
                    "Authorization",
                    "Bearer " + jwtTokenProvider.generateAccessToken(me, "user-" + me)))
        .andReturn();
  }

  private int status(String url) throws Exception {
    return perform(url).getResponse().getStatus();
  }

  private JsonNode getJson(String url) throws Exception {
    var res = perform(url).getResponse();
    String body = res.getContentAsString(java.nio.charset.StandardCharsets.UTF_8);
    assertThat(res.getStatus()).as(body).isEqualTo(200);
    return om.readTree(body);
  }

  private static List<String> titles(JsonNode page) {
    List<String> out = new ArrayList<>();
    page.get("items").forEach(it -> out.add(it.get("title").asText()));
    return out;
  }

  @SuppressWarnings("unchecked")
  private Map<String, Integer> counts(String url) throws Exception {
    return om.convertValue(getJson(url), Map.class);
  }
}
