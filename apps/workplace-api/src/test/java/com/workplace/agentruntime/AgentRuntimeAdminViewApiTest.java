package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.PROJECT_MEMBER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.dto.UpdateAgentLocationRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import com.workplace.user.outbound.TenantAdminAudienceResolver;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1254·1255 관리자 화면용 AI 실행 API 통합 테스트 — 실행 상태 요약(기본 위치는 이름 비움·템플릿 제목·관찰 메시지), AI 가 맡을 프로젝트(실제 멤버
 * + 연결된 저장소만), 관리자만 부를 수 있음, 그리고 실시간 변경 알림({@code resource.changed} — resource "agent-runtime")이
 * 화면에 보이는 것이 바뀔 때만 나가는지.
 *
 * <p>테스트는 트랜잭션을 되돌리므로 커밋 직전 디스패처는 돌지 않는다 — 발행된 {@link ResourceChangedEvent} 를 기록해 확인하고, 수신자는 리졸버를
 * 직접 불러 확인한다.
 */
@Transactional
@RecordApplicationEvents
class AgentRuntimeAdminViewApiTest extends IntegrationTestBase {

  private static final String RUNNER = "/api/v1/agent-runtime/runner";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyService keyService;
  @Autowired TenantAdminAudienceResolver adminAudience;
  @Autowired ApplicationEvents appEvents;

  private long admin;
  private AgentRuntimeTestFixtures fx;
  private long l1;
  private String t1;
  private long l2;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
    var first = locationService.create(admin, new CreateAgentLocationRequest("L1", null, 5));
    l1 = first.location().id();
    t1 = first.plaintextToken();
    l2 =
        locationService
            .create(admin, new CreateAgentLocationRequest("L2", null, 5))
            .location()
            .id();
    appEvents.clear();
  }

  /** 관리자(또는 지정한 사람) 웹 세션으로 부른다 — 필터가 TenantContext 를 비우므로 앞뒤로 다시 맞춘다. */
  private ResultActions call(long userId, MockHttpServletRequestBuilder b) throws Exception {
    TenantContext.set(1L);
    ResultActions r =
        mvc.perform(
            b.with(
                authentication(
                    WebSessionAuth.of(userId, List.of(new SimpleGrantedAuthority("user:write"))))));
    TenantContext.set(1L);
    return r;
  }

  /** runner 토큰으로 부른다. */
  private ResultActions runner(MockHttpServletRequestBuilder b) throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(b.header("Authorization", "Bearer " + t1));
    useTenant(1L);
    return r;
  }

  /** runner 관찰 보고 한 건. */
  private void observed(long agent, long generation, String phase, int cpu) throws Exception {
    runner(
            post(RUNNER + "/observed")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"agents\":[{\"agentUserId\":"
                        + agent
                        + ",\"observedGeneration\":"
                        + generation
                        + ",\"phase\":\""
                        + phase
                        + "\",\"cpuMillicores\":"
                        + cpu
                        + "}]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(1));
  }

  /** AI 키로 상태 보고. */
  private void report(String key, String body) throws Exception {
    useTenant(1L);
    mvc.perform(
            put("/api/v1/agent-runtime/me/status")
                .header("Authorization", "Bearer " + key)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isOk());
    useTenant(1L);
  }

  /** 기록된 agent-runtime 변경 알림들. */
  private List<ResourceChangedEvent> runtimeEvents() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(e -> AgentRuntimeChangeNotifier.RESOURCE_AGENT_RUNTIME.equals(e.resource()))
        .toList();
  }

  private long newAgent() {
    return TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
  }

  /** 테넌트 1 에 프로젝트를 만든다(저장소 주소는 null 가능). */
  private long project(String key, String repositoryUrl, String branch) {
    TenantContext.set(1L);
    return dsl.insertInto(PROJECT)
        .set(PROJECT.KEY, key)
        .set(PROJECT.NAME, "프로젝트 " + key)
        .set(PROJECT.OWNER_ID, admin)
        .set(PROJECT.TYPE, "TEAM")
        .set(PROJECT.REPOSITORY_URL, repositoryUrl)
        .set(PROJECT.REPOSITORY_BRANCH, branch)
        .returning(PROJECT.ID)
        .fetchOne()
        .getId();
  }

  private void addProjectMember(long projectId, long userId) {
    dsl.insertInto(PROJECT_MEMBER)
        .set(PROJECT_MEMBER.PROJECT_ID, projectId)
        .set(PROJECT_MEMBER.USER_ID, userId)
        .set(PROJECT_MEMBER.ROLE, "MEMBER")
        .execute();
  }

  /** 요약 응답에서 그 AI 의 줄. */
  private JsonNode summaryOf(JsonNode list, long agent) {
    for (JsonNode n : list) if (n.get("agentUserId").asLong() == agent) return n;
    return null;
  }

  // ---------------------------------------------------------------- 실행 상태 요약

  /**
   * 요약은 실행 설정이 있는 AI 만, 템플릿 제목·상태와 함께 싣는다. 실행 위치 이름은 기본 위치면(미지정·기본 위치를 직접 지정) null, 기본이 아닌 위치면
   * 이름이다. 관찰 메시지(실패 이유)도 실린다.
   */
  @Test
  void summaries_listAgentsWithSettingAndHideDefaultLocationName() throws Exception {
    long unassigned = fx.runningAgent(null);
    long explicitDefault = fx.newAgent(l1);
    long elsewhere = fx.runningAgent(l2);
    long withoutSetting = newAgent();
    observed(unassigned, fx.generationOf(unassigned), "FAILED", 10);
    TenantContext.set(1L);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_MESSAGE, "이미지를 받지 못했습니다")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(unassigned))
        .execute();

    JsonNode list =
        fx.json(
            call(admin, get("/api/v1/admin/agent-runtime-summaries")).andExpect(status().isOk()));

    assertThat(summaryOf(list, withoutSetting)).isNull();
    JsonNode a = summaryOf(list, unassigned);
    assertThat(a.get("templateName").asText()).isEqualTo("claude-code");
    assertThat(a.get("templateTitle").asText()).isNotBlank();
    assertThat(a.get("status").asText()).isEqualTo("FAILED");
    assertThat(a.get("locationName").isNull()).isTrue();
    assertThat(a.get("message").asText()).isEqualTo("이미지를 받지 못했습니다");
    assertThat(a.has("agentState")).isTrue();
    assertThat(a.has("agentIssueKey")).isTrue();
    assertThat(a.has("agentNextCheckAt")).isTrue();

    JsonNode b = summaryOf(list, explicitDefault);
    assertThat(b.get("status").asText()).isEqualTo("OFF");
    assertThat(b.get("locationName").isNull()).isTrue();

    JsonNode c = summaryOf(list, elsewhere);
    assertThat(c.get("status").asText()).isEqualTo("STARTING");
    assertThat(c.get("locationName").asText()).isEqualTo("L2");
  }

  /** 여러 칸이 일하면(WP-1409) 상세의 관찰 상태와 요약 줄이 현재 이슈를 칸 키 순으로 모두 싣는다. 보고가 없는 AI 는 빈 목록이다. */
  @Test
  void issueKeys_fromAllWorkingSlots_inDetailAndSummary() throws Exception {
    long agent = fx.runningAgent(null);
    long silent = fx.runningAgent(null);
    String key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"WP-1\",\"slot\":\"WP\"}");
    report(key, "{\"state\":\"WORKING\",\"issueKey\":\"HR-2\",\"slot\":\"HR\"}");

    call(admin, get("/api/v1/admin/agents/" + agent + "/runtime-setting"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.observed.agentState").value("WORKING"))
        .andExpect(jsonPath("$.observed.agentIssueKey").value("HR-2"))
        .andExpect(jsonPath("$.observed.agentIssueKeys[0]").value("HR-2"))
        .andExpect(jsonPath("$.observed.agentIssueKeys[1]").value("WP-1"))
        .andExpect(jsonPath("$.observed.agentIssueKeys.length()").value(2));
    call(admin, get("/api/v1/admin/agents/" + silent + "/runtime-setting"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.observed.agentIssueKeys").isArray())
        .andExpect(jsonPath("$.observed.agentIssueKeys.length()").value(0));

    JsonNode list =
        fx.json(
            call(admin, get("/api/v1/admin/agent-runtime-summaries")).andExpect(status().isOk()));
    JsonNode a = summaryOf(list, agent);
    assertThat(a.get("agentIssueKeys").isArray()).isTrue();
    assertThat(a.get("agentIssueKeys").get(0).asText()).isEqualTo("HR-2");
    assertThat(a.get("agentIssueKeys").get(1).asText()).isEqualTo("WP-1");
    assertThat(a.get("agentIssueKeys").size()).isEqualTo(2);
    JsonNode b = summaryOf(list, silent);
    assertThat(b.get("agentIssueKeys").isArray()).isTrue();
    assertThat(b.get("agentIssueKeys").size()).isZero();
  }

  /**
   * 롤링 배포 중 옛 API 인스턴스는 agent_issue_key 만 쓰고 agent_issue_keys 배열을 남겨 둔다(WP-1409) — 배열의 첫 키가
   * agent_issue_key 와 같을 때만 배열을 믿고, 아니면 [agent_issue_key], 그것도 없으면 [] 다.
   */
  @Test
  void issueKeys_fromOldInstanceWrite_fallBackToSingleKey() throws Exception {
    long agent = fx.runningAgent(null);
    String url = "/api/v1/admin/agents/" + agent + "/runtime-setting";

    // 새 인스턴스가 함께 쓴 값 — 배열 그대로.
    setIssueColumns(agent, "HR-2", new String[] {"HR-2", "WP-1"});
    call(admin, get(url))
        .andExpect(jsonPath("$.observed.agentIssueKeys.length()").value(2))
        .andExpect(jsonPath("$.observed.agentIssueKeys[1]").value("WP-1"));

    // 옛 인스턴스가 agent_issue_key 만 바꿈 — 낡은 배열 대신 그 키 하나.
    setIssueColumns(agent, "WP-5", new String[] {"HR-2", "WP-1"});
    call(admin, get(url))
        .andExpect(jsonPath("$.observed.agentIssueKeys.length()").value(1))
        .andExpect(jsonPath("$.observed.agentIssueKeys[0]").value("WP-5"));
    JsonNode list =
        fx.json(
            call(admin, get("/api/v1/admin/agent-runtime-summaries")).andExpect(status().isOk()));
    assertThat(summaryOf(list, agent).get("agentIssueKeys").size()).isEqualTo(1);
    assertThat(summaryOf(list, agent).get("agentIssueKeys").get(0).asText()).isEqualTo("WP-5");

    // 배열이 없음(마이그레이션 전 행) — 그 키 하나.
    setIssueColumns(agent, "WP-5", null);
    call(admin, get(url)).andExpect(jsonPath("$.observed.agentIssueKeys[0]").value("WP-5"));

    // 옛 인스턴스가 쉬는 중 보고로 키를 지움 — 낡은 배열이 남아 있어도 빈 목록.
    setIssueColumns(agent, null, new String[] {"HR-2"});
    call(admin, get(url)).andExpect(jsonPath("$.observed.agentIssueKeys.length()").value(0));
  }

  /** 현재 이슈 칸 두 개를 직접 맞춘다(옛 인스턴스의 쓰기 흉내). */
  private void setIssueColumns(long agent, String issueKey, String[] issueKeys) {
    TenantContext.set(1L);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY, issueKey)
        .set(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEYS, issueKeys)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  /** 기본 위치를 L2 로 옮기면 L2 의 AI 는 이름이 비고, 옛 기본(L1)을 직접 지정한 AI 는 L1 이 보인다. */
  @Test
  void summaries_afterDefaultMoves_followNewDefault() throws Exception {
    long onL1 = fx.newAgent(l1);
    long onL2 = fx.newAgent(l2);
    TenantContext.set(1L);
    locationService.setDefault(l2);

    JsonNode list =
        fx.json(
            call(admin, get("/api/v1/admin/agent-runtime-summaries")).andExpect(status().isOk()));

    assertThat(summaryOf(list, onL1).get("locationName").asText()).isEqualTo("L1");
    assertThat(summaryOf(list, onL2).get("locationName").isNull()).isTrue();
  }

  /** ADMIN 이 아니면 user:write 가 있어도 요약·프로젝트 API 를 부를 수 없다 — 403. */
  @Test
  void summariesAndProjects_whenNotAdmin_return403() throws Exception {
    long member = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    long agent = newAgent();

    call(member, get("/api/v1/admin/agent-runtime-summaries")).andExpect(status().isForbidden());
    call(member, get("/api/v1/admin/agents/" + agent + "/runtime-setting/projects"))
        .andExpect(status().isForbidden());
  }

  // ---------------------------------------------------------------- 맡을 프로젝트

  /** 실제 멤버이고 저장소가 연결된 프로젝트만 키 순으로 나온다 — 멤버가 아닌 프로젝트·저장소 없는 프로젝트는 빠진다. 실행 설정이 없어도 된다. */
  @Test
  void projects_returnsMemberProjectsWithRepositoryOnlySortedByKey() throws Exception {
    long agent = newAgent();
    String s = String.valueOf(System.nanoTime() % 100000);
    long b = project("ZB" + s, "https://github.com/acme/b.git", null);
    long a = project("ZA" + s, "https://github.com/acme/a.git", "develop");
    long noRepo = project("ZC" + s, null, null);
    project("ZD" + s, "https://github.com/acme/d.git", null); // 멤버 아님
    addProjectMember(b, agent);
    addProjectMember(a, agent);
    addProjectMember(noRepo, agent);

    call(admin, get("/api/v1/admin/agents/" + agent + "/runtime-setting/projects"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(2))
        .andExpect(jsonPath("$[0].projectKey").value("ZA" + s))
        .andExpect(jsonPath("$[0].name").value("프로젝트 ZA" + s))
        .andExpect(jsonPath("$[0].repositoryUrl").value("https://github.com/acme/a.git"))
        .andExpect(jsonPath("$[0].repositoryBranch").value("develop"))
        .andExpect(jsonPath("$[1].projectKey").value("ZB" + s))
        .andExpect(jsonPath("$[1].repositoryBranch").isEmpty());
  }

  /** 지워진(soft-delete) 프로젝트는 멤버여도 빠진다. */
  @Test
  void projects_excludesDeletedProject() throws Exception {
    long agent = newAgent();
    long p = project("ZE" + System.nanoTime() % 100000, "https://github.com/acme/e.git", null);
    addProjectMember(p, agent);
    dsl.update(PROJECT)
        .set(PROJECT.DELETED_AT, OffsetDateTime.now())
        .where(PROJECT.ID.eq(p))
        .execute();

    call(admin, get("/api/v1/admin/agents/" + agent + "/runtime-setting/projects"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(0));
  }

  /** 사람·없는 사용자·다른 워크스페이스 사용자는 404 — 실행 설정 API 와 같은 규칙. */
  @Test
  void projects_forHumanOrUnknownOrNonMember_returns404() throws Exception {
    long human = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    long outsider = TestFixtures.createAgentNoToken(dsl);

    call(admin, get("/api/v1/admin/agents/" + human + "/runtime-setting/projects"))
        .andExpect(status().isNotFound());
    call(admin, get("/api/v1/admin/agents/999999999/runtime-setting/projects"))
        .andExpect(status().isNotFound());
    call(admin, get("/api/v1/admin/agents/" + outsider + "/runtime-setting/projects"))
        .andExpect(status().isNotFound());
  }

  // ---------------------------------------------------------------- 실시간 변경 알림

  /** 알림 수신자는 이 워크스페이스의 활성 ADMIN 만 — 일반 구성원·정지된 관리자는 빠진다. */
  @Test
  void adminAudience_resolvesOnlyActiveAdminsOfWorkspace() {
    long member = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    long suspendedAdmin =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, suspendedAdmin, "ADMIN");
    TestFixtures.suspendMember(dsl, suspendedAdmin, 1L);

    assertThat(adminAudience.resolve(1L)).contains(admin).doesNotContain(member, suspendedAdmin);
  }

  /**
   * 실행 설정 저장(새로 만듦 created)·켜기·끄기·다시 시작·바뀐 저장(updated)·삭제(deleted)마다 그 AI id 로 한 번씩 알린다. 바뀐 것이 없는
   * 저장·이미 꺼진 AI 끄기는 알리지 않는다. 수신자 scope 는 TENANT_ADMIN(테넌트 1)이다.
   */
  @Test
  void settingTransitions_publishAgentRuntimeEventOnlyWhenChanged() {
    long agent = newAgent();
    TenantContext.set(1L);
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    settingService.start(admin, agent);
    settingService.restart(admin, agent);
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", l2, Map.of(), null));
    settingService.stop(admin, agent);
    settingService.stop(admin, agent);
    settingService.delete(admin, agent);

    List<ResourceChangedEvent> events = runtimeEvents();
    assertThat(events)
        .extracting(ResourceChangedEvent::op)
        .containsExactly("created", "updated", "updated", "updated", "updated", "deleted");
    assertThat(events)
        .allSatisfy(
            e -> {
              assertThat(e.ids()).containsExactly(agent);
              assertThat(e.scopeType()).isEqualTo(TenantAdminAudienceResolver.SCOPE);
              assertThat(e.scopeId()).isEqualTo(1L);
            });
  }

  /** AI 가 지워지면(꺼져 있어도) 실행 설정 행이 곧 사라지므로 「지워짐」으로 알린다. 꺼진 AI 의 사용 중지는 화면에 보이는 것이 바뀌지 않아 알리지 않는다. */
  @Test
  void removal_publishesDeletedForDeletionAndNothingForStoppedSuspension() {
    long deleted = fx.newAgent(null);
    long suspended = fx.newAgent(null);
    appEvents.clear();

    TenantContext.set(1L);
    settingService.stopForRemoval(deleted, admin, true);
    settingService.stopForRemoval(suspended, null, false);

    assertThat(runtimeEvents()).hasSize(1);
    assertThat(runtimeEvents().get(0).op()).isEqualTo("deleted");
    assertThat(runtimeEvents().get(0).ids()).containsExactly(deleted);
  }

  /**
   * runner 관찰 보고로 상태가 바뀌면(켜는 중 → 실행 중) 그 AI 를 알리고, 같은 상태의 거듭된 보고(CPU 만 다름)는 알리지 않는다. 상태가 다시 바뀌면(실패)
   * 다시 알린다.
   */
  @Test
  void observed_publishesOnVisibleChangeOnly() throws Exception {
    long agent = fx.runningAgent(null);
    long g = fx.generationOf(agent);
    appEvents.clear();

    observed(agent, g, "RUNNING", 100);
    assertThat(runtimeEvents()).hasSize(1);
    assertThat(runtimeEvents().get(0).ids()).containsExactly(agent);

    observed(agent, g, "RUNNING", 250);
    assertThat(runtimeEvents()).hasSize(1);

    observed(agent, g, "FAILED", 250);
    assertThat(runtimeEvents()).hasSize(2);
  }

  /** AI 상태 보고가 상태·이슈 키를 바꾸면 알리고, 같은 내용을 다시 보고하면 알리지 않는다. */
  @Test
  void statusReport_publishesOnChangeAndNotOnIdenticalReReport() throws Exception {
    long agent = fx.runningAgent(null);
    String key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
    long g = fx.generationOf(agent);
    String working =
        "{\"state\":\"WORKING\",\"issueKey\":\"WD-1\",\"nextCheckAt\":\"2026-11-01T12:00:00+09:00\",\"generation\":"
            + g
            + "}";
    appEvents.clear();

    report(key, working);
    assertThat(runtimeEvents()).hasSize(1);
    assertThat(runtimeEvents().get(0).ids()).containsExactly(agent);

    // 같은 순간을 다른 오프셋으로 보내도 같은 보고다.
    report(key, working.replace("2026-11-01T12:00:00+09:00", "2026-11-01T03:00:00Z"));
    assertThat(runtimeEvents()).hasSize(1);

    report(key, "{\"state\":\"IDLE\",\"generation\":" + g + "}");
    assertThat(runtimeEvents()).hasSize(2);
  }

  /** 실행 위치 등록·수정·기본 이동·토큰 재발급·삭제도 알린다 — ids 는 비우고 locationId 를 싣는다. */
  @Test
  void locationChanges_publishAgentRuntimeEvent() {
    TenantContext.set(1L);
    long l3 =
        locationService
            .create(admin, new CreateAgentLocationRequest("L3", null, 2))
            .location()
            .id();
    locationService.update(l3, new UpdateAgentLocationRequest("L3b", null, 3));
    locationService.setDefault(l3);
    locationService.setDefault(l3); // 이미 기본 — 알리지 않는다
    locationService.rotateToken(admin, l3);
    locationService.setDefault(l1);
    locationService.delete(admin, l3);

    List<ResourceChangedEvent> events = runtimeEvents();
    assertThat(events)
        .extracting(ResourceChangedEvent::op)
        .containsExactly("created", "updated", "updated", "updated", "updated", "deleted");
    assertThat(events).allSatisfy(e -> assertThat(e.ids()).isEmpty());
    assertThat(events.get(0).attrs()).containsEntry("locationId", l3);
  }
}
