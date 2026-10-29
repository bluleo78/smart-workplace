package com.workplace.issue.controller;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.global.realtime.SseRegistry;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.issue.domain.IssueKeys;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.repository.AgentWorkRepository;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.repository.ProjectMemberRepository;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.dto.AgentUsernames;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 위임 작업 「AI별」 보기 API(WP-1201) — GET /api/v1/me/ai-agents. 실 JWT + MockMvc 로 범위(나와 관련·전체)·볼 수 없는
 * 프로젝트 작업 건수·동시 진행 자리 수(work-loop 상한 기준)·연결 여부·상태 시각 갱신 규칙을 검증한다. 테스트 트랜잭션 안에서 시드하고 롤백한다.
 */
@Transactional
class AiAgentsControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;
  @Autowired ProjectService projectService;
  @Autowired ProjectMemberRepository projectMemberRepository;
  @Autowired IssueRepository issueRepository;
  @Autowired AgentWorkRepository agentWorkRepository;
  @Autowired SseRegistry sseRegistry;

  private static final Instant T0 = Instant.parse("2026-10-10T00:00:00Z");

  /** 호출자(사람). */
  private long me;

  /** 다른 사람 — 호출자가 멤버가 아닌 프로젝트의 주인. */
  private long other;

  /** 호출자가 멤버인 프로젝트. */
  private long projectId;

  /** 호출자가 멤버가 아닌 프로젝트. */
  private long hiddenProjectId;

  private int nextNumber = 1;

  /** 테스트가 SSE 연결을 연 사용자 — 끝나면 닫는다(레지스트리는 컨텍스트 공유). */
  private final List<Long> connectedUsers = new ArrayList<>();

  @BeforeEach
  void seedUsersAndProjects() {
    // 요청 토큰이 테넌트#1 을 싣으므로 호출자는 그 테넌트의 ACTIVE 멤버여야 한다.
    me = withMembership(createUser("ag-me"));
    other = createUser("ag-ot");
    projectId = projectService.create(me, new CreateProjectRequest(key("AG"), "P-ag", "x")).id();
    hiddenProjectId =
        projectService.create(other, new CreateProjectRequest(key("AH"), "P-hidden", "x")).id();
  }

  @AfterEach
  void closeStreams() {
    connectedUsers.forEach(sseRegistry::closeAll);
  }

  /** 전체 범위 — 활성 AI 가 모두 나오고, 열린 작업·검토 대기·마지막 종료 시각·자리 수(작업 중·대기 중만 셈)가 실린다. */
  @Test
  void list_whenScopeAll_returnsAgentsWithWorksAndSlots() throws Exception {
    long busy = createAgentUserWithMembership("ag-busy");
    long idle = createAgentUserWithMembership("ag-idle");
    long working = issue(projectId, "작업 중 이슈", me);
    long waiting = issue(projectId, "대기 중 이슈", me);
    long blocked = issue(projectId, "막힌 이슈", me);
    long review = issue(projectId, "검토 대기 이슈", me);
    work(working, busy, "WORKING", Instant.now());
    work(waiting, busy, "WAITING", T0);
    work(blocked, busy, "BLOCKED", T0);
    work(review, busy, "REVIEW", T0);
    endedWork(issue(projectId, "끝난 이슈", me), idle, Instant.parse("2026-10-09T03:00:00Z"));

    JsonNode body = getJson("/api/v1/me/ai-agents?scope=ALL");

    assertThat(body.get("slotLimit").asInt()).isEqualTo(3);
    JsonNode b = agent(body, busy);
    assertThat(b.get("agent").get("kind").asText()).isEqualTo("AGENT");
    assertThat(b.get("slotsUsed").asInt()).isEqualTo(2);
    assertThat(b.get("hiddenWorks").asInt()).isZero();
    assertThat(field(b.get("works"), "title"))
        .containsExactly("작업 중 이슈", "대기 중 이슈", "막힌 이슈", "검토 대기 이슈");
    JsonNode first = b.get("works").get(0);
    assertThat(first.get("state").asText()).isEqualTo("WORKING");
    assertThat(first.get("projectKey").asText()).isNotBlank();
    assertThat(first.get("stateChangedAt").asText()).isNotBlank();
    JsonNode i = agent(body, idle);
    assertThat(i.get("works")).isEmpty();
    assertThat(i.get("slotsUsed").asInt()).isZero();
    assertThat(Instant.parse(i.get("lastEndedAt").asText()))
        .isEqualTo(Instant.parse("2026-10-09T03:00:00Z"));
  }

  /** 개인 비서·사용 중지(멤버십 정지)된 AI·사람은 목록에 없다. */
  @Test
  void list_excludesPersonalAssistantsSuspendedAgentsAndHumans() throws Exception {
    long active = createAgentUserWithMembership("ag-on");
    long personal = createAgentUserWithMembership(AgentUsernames.PERSONAL_ASSISTANT_PREFIX + "9");
    long suspended = createAgentUserWithMembership("ag-off");
    dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(suspended))
        .execute();

    List<Long> ids = ids(getJson("/api/v1/me/ai-agents?scope=ALL"));

    assertThat(ids).contains(active).doesNotContain(personal, suspended, me, other);
  }

  /** 나와 관련 — 내가 보고자·담당자인 이슈를 진행 중인 AI 만. 쉬는 AI·남의 이슈만 하는 AI 는 빠진다. */
  @Test
  void list_whenScopeMine_returnsOnlyAgentsOnMyIssues() throws Exception {
    long onMine = createAgentUserWithMembership("ag-mine");
    long onAssigned = createAgentUserWithMembership("ag-asg");
    long onOthers = createAgentUserWithMembership("ag-oth");
    long idle = createAgentUserWithMembership("ag-rest");
    projectMember(projectId, other);
    work(issue(projectId, "내가 만든 이슈", me), onMine, "WORKING", T0);
    long assignedToMe = issue(projectId, "남이 만들고 내가 담당", other);
    assign(assignedToMe, me);
    work(assignedToMe, onAssigned, "WORKING", T0);
    work(issue(projectId, "남의 이슈", other), onOthers, "WORKING", T0);

    List<Long> mine = ids(getJson("/api/v1/me/ai-agents?scope=MINE"));
    List<Long> byDefault = ids(getJson("/api/v1/me/ai-agents"));

    assertThat(mine).contains(onMine, onAssigned).doesNotContain(onOthers, idle);
    assertThat(byDefault).isEqualTo(mine);
  }

  /** 볼 수 없는 프로젝트의 작업은 싣지 않고 건수만 주지만, 자리 수에는 센다. */
  @Test
  void list_whenWorkInInvisibleProject_countsHiddenAndSlot() throws Exception {
    long agent = createAgentUserWithMembership("ag-hide");
    work(issue(hiddenProjectId, "못 보는 이슈", other), agent, "WORKING", Instant.now());
    work(issue(projectId, "보이는 이슈", me), agent, "WAITING", T0);

    JsonNode a = agent(getJson("/api/v1/me/ai-agents?scope=ALL"), agent);

    assertThat(field(a.get("works"), "title")).containsExactly("보이는 이슈");
    assertThat(a.get("hiddenWorks").asInt()).isEqualTo(1);
    assertThat(a.get("slotsUsed").asInt()).isEqualTo(2);
  }

  /** 자리 수 — 작업 중인 하위가 있는 부모와 무소식(2시간 넘게 보고 없는 작업 중)은 세지 않는다(work-loop 상한 기준). */
  @Test
  void list_excludesParentWithWorkingChildAndStaleFromSlots() throws Exception {
    long agent = createAgentUserWithMembership("ag-slot");
    long parent = issue(projectId, "부모", me);
    long child = issue(projectId, "하위", me);
    dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, parent).where(ISSUE.ID.eq(child)).execute();
    work(parent, agent, "WAITING", Instant.now());
    work(child, agent, "WORKING", Instant.now());
    work(issue(projectId, "무소식", me), agent, "WORKING", Instant.now().minusSeconds(3 * 3600));

    JsonNode a = agent(getJson("/api/v1/me/ai-agents?scope=ALL"), agent);

    assertThat(a.get("slotsUsed").asInt()).isEqualTo(1);
    assertThat(field(a.get("works"), "stale")).containsExactly("false", "false", "true");
  }

  /**
   * AI 본인 조회(get_member("me") 가 부르는 GET /members/{내 id})에 실리는 자리(WP-1205)는 AI별 보기의 자리 수와 같은 값이다 — 못
   * 보는 프로젝트 작업은 세고, 작업 중인 하위가 있는 부모·무소식·막힘은 세지 않는다. 자리를 쥔 이슈 키도 함께 싣는다.
   */
  @Test
  void memberSelf_whenAgent_carriesSameSlotsAsRoster() throws Exception {
    long agent = createAgentUserWithMembership("ag-self");
    projectMember(projectId, agent);
    long hidden = issue(hiddenProjectId, "못 보는 이슈", other);
    long parent = issue(projectId, "부모", me);
    long child = issue(projectId, "하위", me);
    dsl.update(ISSUE).set(ISSUE.PARENT_ISSUE_ID, parent).where(ISSUE.ID.eq(child)).execute();
    work(hidden, agent, "WORKING", Instant.now());
    work(parent, agent, "WAITING", Instant.now());
    work(child, agent, "WORKING", Instant.now());
    work(issue(projectId, "무소식", me), agent, "WORKING", Instant.now().minusSeconds(3 * 3600));
    work(issue(projectId, "막힌 이슈", me), agent, "BLOCKED", T0);

    JsonNode slots = getJson("/api/v1/members/" + agent, agent).get("slots");
    JsonNode roster = agent(getJson("/api/v1/me/ai-agents?scope=ALL"), agent);

    assertThat(slots.get("used").asInt()).isEqualTo(roster.get("slotsUsed").asInt()).isEqualTo(2);
    assertThat(slots.get("limit").asInt()).isEqualTo(3);
    assertThat(texts(slots.get("issues"))).containsExactly(issueKey(child));
  }

  /** 자리는 AI 본인 조회에만 — 사람이 AI 를 조회하거나 사람이 자기를 조회하면 키째 없다. */
  @Test
  void member_whenNotAgentSelf_omitsSlots() throws Exception {
    long agent = createAgentUserWithMembership("ag-other");
    work(issue(projectId, "작업", me), agent, "WORKING", Instant.now());

    assertThat(getJson("/api/v1/members/" + agent).has("slots")).isFalse();
    assertThat(getJson("/api/v1/members/" + me).has("slots")).isFalse();
  }

  /** 닫힌 이슈에 남은 진행 중 행은 작업으로 치지 않는다. */
  @Test
  void list_ignoresLiveRowsOnClosedIssues() throws Exception {
    long agent = createAgentUserWithMembership("ag-closed");
    long done = issue(projectId, "닫힌 이슈", me);
    work(done, agent, "WORKING", T0);
    dsl.update(ISSUE)
        .set(ISSUE.STATUS, "DONE")
        .set(ISSUE.STATUS_ID, TestFixtures.defaultStatusId(ISSUE.PROJECT_ID, "DONE"))
        .where(ISSUE.ID.eq(done))
        .execute();

    JsonNode a = agent(getJson("/api/v1/me/ai-agents?scope=ALL"), agent);

    assertThat(a.get("works")).isEmpty();
    assertThat(a.get("slotsUsed").asInt()).isZero();
  }

  /** 연결 여부 — 외부 AI 는 SSE 연결이 있으면 연결됨, 한 번도 안 붙었으면 끊김(시각 모름). 서버 안 AI 는 판단하지 않는다(null). */
  @Test
  void list_reportsConnectionForExternalAgentsOnly() throws Exception {
    long online = externalAgent("ag-online");
    long offline = externalAgent("ag-offline");
    long internal = createAgentUserWithMembership("ag-internal");
    sseRegistry.register(online);
    connectedUsers.add(online);

    JsonNode body = getJson("/api/v1/me/ai-agents?scope=ALL");

    assertThat(agent(body, online).get("connected").asBoolean()).isTrue();
    assertThat(agent(body, offline).get("connected").asBoolean()).isFalse();
    assertThat(agent(body, offline).get("disconnectedAt").isNull()).isTrue();
    assertThat(agent(body, internal).get("connected").isNull()).isTrue();
  }

  /** 막 끊긴 외부 AI 는 다시 붙는 동안(유예 3분)에는 연결로 본다 — 1시간마다 다시 붙는 틈에 「연결 끊김」이 깜빡이지 않게. */
  @Test
  void list_whenJustDisconnected_staysConnectedWithinGrace() throws Exception {
    long agent = externalAgent("ag-blink");
    sseRegistry.register(agent);
    sseRegistry.closeAll(agent);

    JsonNode a = agent(getJson("/api/v1/me/ai-agents?scope=ALL"), agent);

    assertThat(sseRegistry.lastSeen(agent)).isPresent();
    assertThat(a.get("connected").asBoolean()).isTrue();
    assertThat(a.get("disconnectedAt").isNull()).isTrue();
  }

  /** 상태 시각 — note 만 바꾼 보고는 그대로 두고, 상태를 바꾸면 올린다. 같은 상태 재보고도 그대로. */
  @Test
  void update_movesStateChangedAtOnlyWhenStateChanges() {
    long agent = createAgentUserWithMembership("ag-time");
    long issueId = issue(projectId, "시각 이슈", me);
    work(issueId, agent, "WORKING", T0);
    long workId = workId(issueId);

    agentWorkRepository.update(
        workId, new AgentWorkPatch(null, null, "메모만", false, null, null, null));
    agentWorkRepository.update(
        workId, new AgentWorkPatch(null, "WORKING", "같은 상태", false, null, null, null));
    Instant afterNote = stateChangedAt(workId);
    agentWorkRepository.update(
        workId, new AgentWorkPatch(null, "INPUT_REQUIRED", "질문", false, null, null, null));
    Instant afterState = stateChangedAt(workId);

    assertThat(afterNote).isEqualTo(T0);
    assertThat(afterState).isAfter(T0);
  }

  /** 사람이 답해 답변 필요 → 작업 중으로 되돌리면 상태 시각도 올린다. */
  @Test
  void resumeInputRequiredAgents_movesStateChangedAt() {
    long agent = createAgentUserWithMembership("ag-resume");
    long issueId = issue(projectId, "답 기다리는 이슈", me);
    work(issueId, agent, "INPUT_REQUIRED", T0);

    agentWorkRepository.resumeInputRequiredAgents(issueId);

    assertThat(stateChangedAt(workId(issueId))).isAfter(T0);
  }

  // ---------------------------------------------------------------- 시드·요청 도우미

  private long createUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    grantUserRole(id);
    return id;
  }

  /** 외부 실행 AI(EXTERNAL) — 연결 여부를 판단하는 대상. */
  private long externalAgent(String prefix) {
    long id = createAgentUserWithMembership(prefix);
    dsl.update(USER).set(USER.AGENT_RUNTIME, "EXTERNAL").where(USER.ID.eq(id)).execute();
    return id;
  }

  private static String key(String prefix) {
    return prefix + UUID.randomUUID().toString().replaceAll("-", "").toUpperCase().substring(0, 6);
  }

  private void projectMember(long project, long userId) {
    projectMemberRepository.insert(project, userId, "MEMBER");
  }

  private long issue(long project, String title, long reporter) {
    return IssueSeeds.insert(
            issueRepository, baseDsl, project, nextNumber++, title, null, "MID", null, reporter)
        .id();
  }

  private void assign(long issueId, long userId) {
    dsl.insertInto(ISSUE_ASSIGNEE)
        .set(ISSUE_ASSIGNEE.ISSUE_ID, issueId)
        .set(ISSUE_ASSIGNEE.USER_ID, userId)
        .set(ISSUE_ASSIGNEE.ASSIGNED_BY, me)
        .execute();
  }

  /** 진행 중 작업 시드 — 마지막 보고·상태 시각을 같은 값으로. */
  private void work(long issueId, long workerId, String state, Instant at) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, state)
        .set(AGENT_WORK.UPDATED_AT, at.atOffset(ZoneOffset.UTC))
        .set(AGENT_WORK.STATE_CHANGED_AT, at.atOffset(ZoneOffset.UTC))
        .execute();
  }

  private void endedWork(long issueId, long workerId, Instant endedAt) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.STATE, "COMPLETED")
        .set(AGENT_WORK.UPDATED_AT, endedAt.atOffset(ZoneOffset.UTC))
        .set(AGENT_WORK.ENDED_AT, endedAt.atOffset(ZoneOffset.UTC))
        .execute();
  }

  private long workId(long issueId) {
    return dsl.select(AGENT_WORK.ID)
        .from(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .fetchOne(AGENT_WORK.ID);
  }

  private Instant stateChangedAt(long workId) {
    OffsetDateTime t =
        dsl.select(AGENT_WORK.STATE_CHANGED_AT)
            .from(AGENT_WORK)
            .where(AGENT_WORK.ID.eq(workId))
            .fetchOne(AGENT_WORK.STATE_CHANGED_AT);
    return t.toInstant();
  }

  private JsonNode getJson(String url) throws Exception {
    return getJson(url, me);
  }

  /** 호출자를 골라 GET — AI 본인 조회(WP-1205)처럼 사람이 아닌 신원으로 부를 때. */
  private JsonNode getJson(String url, long caller) throws Exception {
    var res =
        mvc.perform(
                get(url)
                    .header(
                        "Authorization",
                        "Bearer "
                            + jwtTokenProvider.generateAccessToken(caller, "user-" + caller, 1L)))
            .andReturn()
            .getResponse();
    String body = res.getContentAsString(StandardCharsets.UTF_8);
    assertThat(res.getStatus()).as(body).isEqualTo(200);
    return om.readTree(body);
  }

  /** 응답에서 한 AI — 없으면 실패. */
  private static JsonNode agent(JsonNode body, long id) {
    for (JsonNode a : body.get("agents")) {
      if (a.get("agent").get("id").asLong() == id) return a;
    }
    throw new AssertionError("AI " + id + " 가 응답에 없다: " + body);
  }

  private static List<Long> ids(JsonNode body) {
    List<Long> out = new ArrayList<>();
    body.get("agents").forEach(a -> out.add(a.get("agent").get("id").asLong()));
    return out;
  }

  private static List<String> field(JsonNode rows, String name) {
    List<String> out = new ArrayList<>();
    rows.forEach(r -> out.add(r.get(name).asText()));
    return out;
  }

  /** 문자열 배열 → 목록. */
  private static List<String> texts(JsonNode arr) {
    List<String> out = new ArrayList<>();
    arr.forEach(v -> out.add(v.asText()));
    return out;
  }

  /** 이슈 키(예: AG1234-5). */
  private String issueKey(long issueId) {
    var r =
        dsl.select(PROJECT.KEY, ISSUE.NUMBER)
            .from(ISSUE)
            .join(PROJECT)
            .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
            .where(ISSUE.ID.eq(issueId))
            .fetchOne();
    return IssueKeys.format(r.get(PROJECT.KEY), r.get(ISSUE.NUMBER));
  }
}
