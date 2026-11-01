package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.service.AgentRemovalService;
import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1247 AI 별 실행 설정·원하는 상태 API 통합 테스트 — 저장(실행 방식 EXTERNAL 전환·검증·generation), 켜기·끄기·다시 시작·삭제 규칙, 자리
 * 상한·기본 위치, 템플릿 누락·버전 갱신, 실행 방식 「내부」 전환 가드, 위치 쪽 연동(사용 수·삭제·기본 이동), 테넌트 격리.
 */
@Transactional
@RecordApplicationEvents
class AdminAgentRuntimeSettingApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired com.fasterxml.jackson.databind.ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired WorkspaceAssistantService workspaceAssistantService;
  @Autowired ApplicationEvents appEvents;
  @Autowired AgentRemovalService agentRemovalService;

  private long admin;
  private AgentRuntimeTestFixtures fx;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    fx = new AgentRuntimeTestFixtures(dsl, om, settingService, admin);
  }

  private Authentication auth(long userId) {
    return WebSessionAuth.of(userId, List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 매 호출 전에 테넌트를 다시 맞춘다. */
  private ResultActions call(MockHttpServletRequestBuilder b) throws Exception {
    TenantContext.set(1L);
    ResultActions r = mvc.perform(b.with(authentication(auth(admin))));
    TenantContext.set(1L);
    return r;
  }

  private String base(long agent) {
    return "/api/v1/admin/agents/" + agent + "/runtime-setting";
  }

  private long newAgent() {
    return TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
  }

  private long newLocation(String name, int capacity) {
    TenantContext.set(1L);
    return locationService
        .create(admin, new CreateAgentLocationRequest(name, null, capacity))
        .location()
        .id();
  }

  private ResultActions putSetting(long agent, String body) throws Exception {
    return call(put(base(agent)).contentType(MediaType.APPLICATION_JSON).content(body));
  }

  private ResultActions putClaude(long agent) throws Exception {
    return putSetting(agent, "{\"templateName\":\"claude-code\",\"config\":{}}");
  }

  private ResultActions action(long agent, String verb) throws Exception {
    return call(post(base(agent) + "/" + verb));
  }

  private List<AgentRuntimeDesiredChanged> desiredEvents() {
    return appEvents.stream(AgentRuntimeDesiredChanged.class).toList();
  }

  private int settingRows(long agent) {
    return dsl.fetchCount(AGENT_RUNTIME_SETTING, AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent));
  }

  /** 새 설정은 generation 1·꺼짐으로 만들어지고 템플릿 기본값이 채워지며 실행 방식이 EXTERNAL 로 바뀐다. */
  @Test
  void put_newSetting_createsStoppedGenerationOneAndSwitchesToExternal() throws Exception {
    long agent = newAgent();

    putClaude(agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.generation").value(1))
        .andExpect(jsonPath("$.desired").value("STOP"))
        .andExpect(jsonPath("$.status").value("OFF"))
        .andExpect(jsonPath("$.templateVersion").value("1"))
        .andExpect(jsonPath("$.templateMissing").value(false))
        .andExpect(jsonPath("$.updateAvailable").value(false))
        .andExpect(jsonPath("$.config.model").value("opus"))
        .andExpect(jsonPath("$.config.queue").value("AI 개발팀"));

    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("EXTERNAL");
  }

  /** 서버형 템플릿(「기본」)은 실행 설정으로 저장할 수 없다 — 400. */
  @Test
  void put_whenTemplateIsServerKind_returns400() throws Exception {
    putSetting(newAgent(), "{\"templateName\":\"default\"}").andExpect(status().isBadRequest());
  }

  /** 선택지 밖 설정 값은 400. */
  @Test
  void put_whenConfigInvalid_returns400() throws Exception {
    putSetting(newAgent(), "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"gpt\"}}")
        .andExpect(status().isBadRequest());
  }

  /** 공통 비서는 EXTERNAL 이 될 수 없어 실행 설정도 둘 수 없다 — 409, 행 없음. */
  @Test
  void put_forWorkspaceAssistant_returns409() throws Exception {
    long agent = newAgent();
    workspaceAssistantService.setAgent(admin, agent);

    putClaude(agent).andExpect(status().isConflict());

    assertThat(settingRows(agent)).isZero();
  }

  /** 사람에게는 실행 설정을 둘 수 없다 — 400. */
  @Test
  void put_whenHuman_returns400() throws Exception {
    long human = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));

    putClaude(human).andExpect(status().isBadRequest());
  }

  /** 설정이 바뀌면 generation 이 오르고 기본 위치로 이벤트가 나간다. 같은 값 재전송은 아무것도 바꾸지 않는다. */
  @Test
  void put_whenConfigChanged_bumpsGenerationAndPublishesEvent() throws Exception {
    long loc = newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent).andExpect(status().isOk());
    appEvents.clear();
    String sonnet = "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"sonnet\"}}";

    putSetting(agent, sonnet)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.generation").value(2))
        .andExpect(jsonPath("$.applyMode").value("IDLE"))
        .andExpect(jsonPath("$.effectiveLocation.id").value(loc));
    assertThat(desiredEvents()).containsExactly(new AgentRuntimeDesiredChanged(1L, loc));

    appEvents.clear();
    putSetting(agent, sonnet)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.generation").value(2));
    assertThat(desiredEvents()).isEmpty();
  }

  /** 위치를 바꾸면 옛·새 위치 둘 다 알린다. */
  @Test
  void put_whenLocationChanged_publishesBothLocations() throws Exception {
    long first = newLocation("첫째", 3);
    long second = newLocation("둘째", 3);
    long agent = newAgent();
    putClaude(agent).andExpect(status().isOk());
    appEvents.clear();

    putSetting(agent, "{\"templateName\":\"claude-code\",\"locationId\":" + second + "}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.locationId").value(second))
        .andExpect(jsonPath("$.effectiveLocation.id").value(second));

    assertThat(desiredEvents())
        .containsExactlyInAnyOrder(
            new AgentRuntimeDesiredChanged(1L, first), new AgentRuntimeDesiredChanged(1L, second));
  }

  /** 켜기 — desired RUN, 관찰 전이라 STARTING, 바로 적용(NOW). */
  @Test
  void start_setsRunAndGeneration() throws Exception {
    long loc = newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    appEvents.clear();

    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"))
        .andExpect(jsonPath("$.status").value("STARTING"))
        .andExpect(jsonPath("$.applyMode").value("NOW"))
        .andExpect(jsonPath("$.generation").value(2));
    assertThat(desiredEvents()).containsExactly(new AgentRuntimeDesiredChanged(1L, loc));

    // 이미 켜져 있으면 변화 없음.
    action(agent, "start").andExpect(status().isOk()).andExpect(jsonPath("$.generation").value(2));
  }

  /** 위치를 지정하지 않았는데 기본 위치도 없으면 켤 수 없다 — 409. */
  @Test
  void start_whenNoDefaultLocation_returns409() throws Exception {
    long agent = newAgent();
    putClaude(agent);

    action(agent, "start").andExpect(status().isConflict());
  }

  /** 자리 1개짜리 위치에서 두 번째 AI 를 켜면 409. */
  @Test
  void start_whenLocationFull_returns409() throws Exception {
    newLocation("작은 곳", 1);
    long a = newAgent();
    long b = newAgent();
    putClaude(a);
    putClaude(b);
    action(a, "start").andExpect(status().isOk());

    action(b, "start")
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("실행 위치의 자리가 모두 찼습니다"))
        .andExpect(jsonPath("$.errors.code").value("AGENT_RUNTIME_SETTING_CONFLICT"));
    assertThat(desiredOf(b)).isEqualTo("STOP");
  }

  /** 끄기 — desired STOP, generation +1. */
  @Test
  void stop_setsStop() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start");

    action(agent, "stop")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("STOP"))
        .andExpect(jsonPath("$.status").value("OFF"))
        .andExpect(jsonPath("$.generation").value(3));
  }

  /** 꺼진 AI 는 다시 시작할 수 없다 — 409. 켜진 AI 는 generation +1·NOW. */
  @Test
  void restart_whenStopped_returns409() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);

    action(agent, "restart").andExpect(status().isConflict());

    action(agent, "start");
    action(agent, "restart")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.generation").value(3));
  }

  /** 켜져 있는 AI 의 실행 설정은 지울 수 없다 — 409. */
  @Test
  void delete_whenRunning_returns409() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start");

    call(delete(base(agent))).andExpect(status().isConflict());
    assertThat(settingRows(agent)).isOne();
  }

  /** 꺼진 AI 의 실행 설정은 지워지고, 실행 방식은 그대로(EXTERNAL) 둔다. */
  @Test
  void delete_whenStopped_returns204() throws Exception {
    long agent = newAgent();
    putClaude(agent);

    call(delete(base(agent))).andExpect(status().isNoContent());

    assertThat(settingRows(agent)).isZero();
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("EXTERNAL");
    call(get(base(agent))).andExpect(status().isNotFound());
  }

  /** 저장된 템플릿이 레지스트리에서 사라져도 조회는 200 이고 templateMissing 으로 알린다. 켜기는 409. */
  @Test
  void get_whenTemplateRemoved_flagsMissing() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, "gone")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.templateMissing").value(true))
        .andExpect(jsonPath("$.updateAvailable").value(false));
    action(agent, "start").andExpect(status().isConflict());
  }

  /** 다른 워크스페이스에서는 설정이 보이지 않는다(구성원 가드·RLS). */
  @Test
  void get_fromOtherTenant_returns404() throws Exception {
    long agent = newAgent();
    putClaude(agent).andExpect(status().isOk());
    assertThat(settingService.get(agent).agentUserId()).isEqualTo(agent);

    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    // 같은 AI 를 테넌트 2 구성원으로도 만들어 구성원 가드를 통과시킨 뒤 RLS 가 행을 가리는지 본다.
    TestFixtures.addMember(dsl, agent, tenant2);
    useTenant(tenant2);

    assertThatThrownBy(() -> settingService.get(agent))
        .isInstanceOf(
            com.workplace.agentruntime.exception.AgentRuntimeSettingNotFoundException.class);
  }

  /** Works 가 켜 둔 AI 를 실행 방식 「내부」로 바꾸면 409 — 설정 행과 desired 는 그대로. */
  @Test
  void setRuntimeInternal_whenRunning_returns409() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start");

    call(put("/api/v1/admin/agents/" + agent + "/runtime")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"runtime\":\"INTERNAL\"}"))
        .andExpect(status().isConflict());

    // 클래스 트랜잭션 안이라 user 갱신은 롤백 표시만 되고 보인다 — 설정 행만 확인한다.
    assertThat(
            dsl.select(AGENT_RUNTIME_SETTING.DESIRED)
                .from(AGENT_RUNTIME_SETTING)
                .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
                .fetchOne(AGENT_RUNTIME_SETTING.DESIRED))
        .isEqualTo("RUN");
  }

  /** 꺼져 있는 AI 를 「내부」로 바꾸면 실행 설정이 지워진다(「기본」 = 행 없음 + INTERNAL). */
  @Test
  void setRuntimeInternal_whenStopped_deletesSetting() throws Exception {
    long agent = newAgent();
    putClaude(agent);

    call(put("/api/v1/admin/agents/" + agent + "/runtime")
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"runtime\":\"INTERNAL\"}"))
        .andExpect(status().isNoContent());

    assertThat(settingRows(agent)).isZero();
    assertThat(TestFixtures.runtimeOf(dsl, agent)).isEqualTo("INTERNAL");
  }

  /** 위치 목록의 used 는 그 위치에서 켜져 있는 AI 수(기본 위치는 위치 미지정 AI 포함). */
  @Test
  void location_used_countsRunningSettings() throws Exception {
    long def = newLocation("기본", 3);
    long other = newLocation("다른 곳", 3);
    long a = newAgent();
    long b = newAgent();
    long c = newAgent();
    putClaude(a);
    putClaude(b);
    putSetting(c, "{\"templateName\":\"claude-code\",\"locationId\":" + other + "}");
    action(a, "start");
    action(c, "start");

    assertThat(locationService.get(def).used()).isEqualTo(1);
    assertThat(locationService.get(other).used()).isEqualTo(1);
    action(b, "start");
    assertThat(locationService.get(def).used()).isEqualTo(2);
  }

  /** 실행 설정이 쓰는 위치는 지울 수 없다 — 500 이 아니라 409. */
  @Test
  void deleteLocation_whenUsedBySetting_returns409() throws Exception {
    newLocation("기본", 3);
    long other = newLocation("다른 곳", 3);
    long agent = newAgent();
    putSetting(agent, "{\"templateName\":\"claude-code\",\"locationId\":" + other + "}");

    call(delete("/api/v1/admin/agent-locations/" + other)).andExpect(status().isConflict());
  }

  /** 켜져 있는 AI 를 자리가 찬 위치로 옮기면 409. */
  @Test
  void put_whenRunningAndLocationChangedToFull_returns409() throws Exception {
    newLocation("기본", 3);
    long small = newLocation("작은 곳", 1);
    long a = newAgent();
    long b = newAgent();
    putSetting(a, "{\"templateName\":\"claude-code\",\"locationId\":" + small + "}");
    action(a, "start").andExpect(status().isOk());
    putClaude(b);
    action(b, "start").andExpect(status().isOk());

    putSetting(b, "{\"templateName\":\"claude-code\",\"locationId\":" + small + "}")
        .andExpect(status().isConflict());
  }

  /** 위치 미지정으로 켜진 AI 들이 새 기본 위치의 자리를 넘으면 기본을 옮길 수 없다 — 409. */
  @Test
  void setDefault_whenNewDefaultTooSmall_returns409() throws Exception {
    long def = newLocation("기본", 3);
    long small = newLocation("작은 곳", 1);
    long a = newAgent();
    long b = newAgent();
    putClaude(a);
    putClaude(b);
    action(a, "start");
    action(b, "start");

    call(post("/api/v1/admin/agent-locations/" + small + "/default"))
        .andExpect(status().isConflict());
    assertThat(locationService.defaultLocationId()).contains(def);
  }

  /** 기본 위치를 옮기면 옛·새 기본 위치 둘 다 알린다. */
  @Test
  void setDefault_publishesOldAndNewDefault() throws Exception {
    long def = newLocation("기본", 3);
    long next = newLocation("다음", 3);
    appEvents.clear();

    call(post("/api/v1/admin/agent-locations/" + next + "/default"))
        .andExpect(status().isNoContent());

    assertThat(desiredEvents())
        .containsExactlyInAnyOrder(
            new AgentRuntimeDesiredChanged(1L, def), new AgentRuntimeDesiredChanged(1L, next));
  }

  /** 저장된 템플릿 버전이 레지스트리보다 옛것이면 updateAvailable. */
  @Test
  void get_whenTemplateVersionOlder_flagsUpdateAvailable() throws Exception {
    long agent = newAgent();
    putClaude(agent);
    setStoredVersion(agent, "0");

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.templateVersion").value("0"))
        .andExpect(jsonPath("$.updateAvailable").value(true));
  }

  /** 켜면 템플릿 버전을 현재 버전으로 다시 고정하고 generation 은 한 번만 오른다. 없어진 설정 칸은 버린다. */
  @Test
  void start_repinsTemplateVersionAndBumpsGeneration() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    setStoredVersion(agent, "0");
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(
            AGENT_RUNTIME_SETTING.CONFIG,
            org.jooq.JSONB.valueOf("{\"model\":\"sonnet\",\"retired\":\"x\"}"))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.templateVersion").value("1"))
        .andExpect(jsonPath("$.updateAvailable").value(false))
        .andExpect(jsonPath("$.generation").value(2))
        .andExpect(jsonPath("$.config.model").value("sonnet"))
        .andExpect(jsonPath("$.config.retired").doesNotExist());
  }

  private void setStoredVersion(long agent, String version) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION, version)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private String desiredOf(long agent) {
    return dsl.select(AGENT_RUNTIME_SETTING.DESIRED)
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne(AGENT_RUNTIME_SETTING.DESIRED);
  }

  /** 켜 둔 AI 를 완전히 지우면 행이 CASCADE 로 사라지기 전에 그 위치의 runner 에게 알린다(자리도 비워진다). */
  @Test
  void removeAgent_whenRunningAndDeleted_publishesToItsLocation() throws Exception {
    long loc = newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start").andExpect(status().isOk());
    appEvents.clear();

    TenantContext.set(1L);
    assertThat(agentRemovalService.remove(admin, agent))
        .isEqualTo(AgentRemovalService.Result.DELETED);

    assertThat(desiredEvents()).containsExactly(new AgentRuntimeDesiredChanged(1L, loc));
    assertThat(settingRows(agent)).isZero();
    assertThat(locationService.get(loc).used()).isZero();
  }

  /** 켜 둔 AI 가 사용 중지되면(다른 워크스페이스에도 속해 지우지 못함) 끄기로 바뀌고 그 위치의 runner 에게 알린다 — 자리를 붙잡지 않게. */
  @Test
  void removeAgent_whenRunningAndDeactivated_stopsAndPublishes() throws Exception {
    long loc = newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start").andExpect(status().isOk());
    long before = fx.generationOf(agent);
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    TestFixtures.addMember(dsl, agent, tenant2);
    appEvents.clear();

    TenantContext.set(1L);
    assertThat(agentRemovalService.remove(admin, agent))
        .isEqualTo(AgentRemovalService.Result.DEACTIVATED);

    TenantContext.set(1L);
    assertThat(desiredOf(agent)).isEqualTo("STOP");
    assertThat(fx.generationOf(agent)).isEqualTo(before + 1);
    assertThat(desiredEvents()).contains(new AgentRuntimeDesiredChanged(1L, loc));
    assertThat(locationService.get(loc).used()).isZero();
  }

  /**
   * 켜진 AI 를 위치 미지정(기본 따라가기)으로 저장하면 지금의 기본 위치 자리를 본다 — 기본이 가득 차면 409, 기본을 옮긴 뒤에는 새 기본으로 옮겨 가고 옛·새 실제
   * 위치 둘 다 알린다.
   */
  @Test
  void put_whenRunningAndUnassigned_usesCurrentDefault() throws Exception {
    long full = newLocation("가득 찬 곳", 1);
    long next = newLocation("새 기본", 3);
    long assigned = newLocation("지정 위치", 3);
    long a = newAgent();
    long b = newAgent();
    putSetting(a, "{\"templateName\":\"claude-code\",\"locationId\":" + full + "}");
    action(a, "start").andExpect(status().isOk());
    putSetting(b, "{\"templateName\":\"claude-code\",\"locationId\":" + assigned + "}");
    action(b, "start").andExpect(status().isOk());

    // 기본(가득 찬 곳)에 자리가 없어 위치 지정을 풀 수 없다.
    putClaude(b).andExpect(status().isConflict());

    call(post("/api/v1/admin/agent-locations/" + next + "/default"))
        .andExpect(status().isNoContent());
    appEvents.clear();

    putClaude(b)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.effectiveLocation.id").value(next))
        .andExpect(jsonPath("$.effectiveLocation.used").value(1));
    assertThat(desiredEvents())
        .containsExactlyInAnyOrder(
            new AgentRuntimeDesiredChanged(1L, assigned), new AgentRuntimeDesiredChanged(1L, next));
    assertThat(locationService.get(assigned).used()).isZero();
  }

  /** 켜진 AI 의 위치 지정을 풀어도 실제 위치(기본)가 같으면 자기 자신을 세어 자리 부족으로 막지 않는다. */
  @Test
  void put_whenRunningAndUnassignedToSameDefault_doesNotCountItself() throws Exception {
    long def = newLocation("기본", 1);
    long agent = newAgent();
    putSetting(agent, "{\"templateName\":\"claude-code\",\"locationId\":" + def + "}");
    action(agent, "start").andExpect(status().isOk());

    putClaude(agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.effectiveLocation.id").value(def));
  }

  /** 없는 위치를 지정하면 404. */
  @Test
  void put_withMissingLocation_returns404() throws Exception {
    putSetting(newAgent(), "{\"templateName\":\"claude-code\",\"locationId\":999999}")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.message").value("실행 위치를 찾을 수 없습니다"))
        .andExpect(jsonPath("$.errors.code").value("AGENT_LOCATION_NOT_FOUND"));
  }

  /** 이미 EXTERNAL 인 AI 의 설정을 다시 저장해도 실행 방식 변경 감사 기록을 또 남기지 않는다. */
  @Test
  void put_whenAlreadyExternal_doesNotAuditRuntimeChangeAgain() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent).andExpect(status().isOk());
    putSetting(agent, "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"sonnet\"}}")
        .andExpect(status().isOk());

    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .ACTION_TYPE
                    .eq("AGENT_RUNTIME_CHANGED")
                    .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(agent)))))
        .isOne();
  }

  /** 켜져 있는 AI 수보다 자리 수를 적게 줄일 수 없다 — 409. 같은 수까지는 줄일 수 있다. */
  @Test
  void updateLocation_whenCapacityBelowRunning_returns409() throws Exception {
    long loc = newLocation("운영", 3);
    long a = newAgent();
    long b = newAgent();
    putClaude(a);
    putClaude(b);
    action(a, "start").andExpect(status().isOk());
    action(b, "start").andExpect(status().isOk());

    call(put("/api/v1/admin/agent-locations/" + loc)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"운영\",\"capacity\":1}"))
        .andExpect(status().isConflict());
    call(put("/api/v1/admin/agent-locations/" + loc)
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"운영\",\"capacity\":2}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.capacity").value(2));
  }

  /** 위치 목록의 켜진 수 — 지정·미지정(기본) 모두 맞게 센다. */
  @Test
  void listLocations_countsUsedForAssignedAndUnassigned() throws Exception {
    long def = newLocation("기본", 3);
    long other = newLocation("다른 곳", 3);
    long a = newAgent();
    long b = newAgent();
    long c = newAgent();
    putClaude(a);
    putSetting(b, "{\"templateName\":\"claude-code\",\"locationId\":" + def + "}");
    putSetting(c, "{\"templateName\":\"claude-code\",\"locationId\":" + other + "}");
    action(a, "start");
    action(b, "start");
    action(c, "start");

    TenantContext.set(1L);
    var list = locationService.list();

    assertThat(list)
        .extracting(l -> l.id() + ":" + l.used())
        .containsExactly(def + ":2", other + ":1");
  }
}
