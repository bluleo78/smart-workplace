package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AGENT_WORK;
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
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.service.AgentRemovalService;
import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import com.workplace.issue.repository.IssueRepository;
import com.workplace.issue.support.IssueSeeds;
import com.workplace.project.dto.CreateProjectRequest;
import com.workplace.project.service.ProjectService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
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
import tools.jackson.databind.JsonNode;

/**
 * WP-1247 AI 별 실행 설정·원하는 상태 API 통합 테스트 — 저장(실행 방식 EXTERNAL 전환·검증·generation), 켜기·끄기·다시 시작·삭제 규칙, 자리
 * 상한·기본 위치, 템플릿 누락·버전 갱신, 실행 방식 「내부」 전환 가드, 위치 쪽 연동(사용 수·삭제·기본 이동), 테넌트 격리.
 */
@Transactional
@RecordApplicationEvents
class AdminAgentRuntimeSettingApiTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired tools.jackson.databind.ObjectMapper om;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired WorkspaceAssistantService workspaceAssistantService;
  @Autowired ApplicationEvents appEvents;
  @Autowired AgentRemovalService agentRemovalService;
  @Autowired ProjectService projectService;
  @Autowired IssueRepository issueRepository;

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

  /** 지금까지 나간 AI 실행 관리자 알림 수. */
  private long adminEvents() {
    return appEvents.stream(ResourceChangedEvent.class)
        .filter(e -> AgentRuntimeChangeNotifier.RESOURCE_AGENT_RUNTIME.equals(e.resource()))
        .count();
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

  /** 선택지 밖 설정 값은 400 — 계정 모델 목록을 쓰지 않는 select(Gen:iA Code 모델)는 지금 규칙 그대로. */
  @Test
  void put_whenConfigInvalid_returns400() throws Exception {
    putSetting(newAgent(), "{\"templateName\":\"genia-code\",\"config\":{\"model\":\"gpt\"}}")
        .andExpect(status().isBadRequest());
  }

  /** 계정 모델 칸(claude-code model)은 정적 선택지 밖의 전체 모델 id 도 저장된다(WP-1405). */
  @Test
  void put_whenModelOffList_saves() throws Exception {
    putSetting(
            newAgent(),
            "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"claude-opus-5-5[1m]\"}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.config.model").value("claude-opus-5-5[1m]"));
  }

  /** 목록 밖 id 로 저장한 AI 를 켜도(템플릿 버전 repin 으로 다시 검증) 400 없이 켜지고 값이 유지된다(WP-1405). */
  @Test
  void start_whenSavedModelOffList_starts() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putSetting(
            agent, "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"claude-haiku-4-5\"}}")
        .andExpect(status().isOk());
    setStoredVersion(agent, "0");

    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.templateVersion").value("1"))
        .andExpect(jsonPath("$.config.model").value("claude-haiku-4-5"));
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

  /**
   * 화면의 「지금 적용」(WP-1515) — 저장된 설정을 그대로 applyMode NOW 로 다시 저장하면, 켜져 있고 미뤄 둔 generation 이 있을 때
   * apply_mode 만 NOW 로 바뀌고(generation 그대로) runner 에 알린다. 미뤄 둔 generation 이 없으면 지금처럼 아무것도 바뀌지 않는다.
   */
  @Test
  void put_whenUnchangedWithApplyNowAndDeferredGeneration_marksNow() throws Exception {
    long loc = newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent).andExpect(status().isOk());
    action(agent, "start").andExpect(status().isOk());
    // 켜진 Pod 가 지금 generation 으로 일하는 중 — 그 뒤 설정을 바꿔 쉴 때 적용으로 미룬다.
    setWorkingAtCurrentGeneration(agent);
    String sonnet = "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"sonnet\"}}";
    putSetting(agent, sonnet)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.applyMode").value("IDLE"));
    long deferred = fx.generationOf(agent);
    appEvents.clear();

    putSetting(
            agent,
            "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"sonnet\"},\"applyMode\":\"NOW\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.applyMode").value("NOW"))
        .andExpect(jsonPath("$.generation").value(deferred));

    assertThat(applyModeOf(agent)).isEqualTo("NOW");
    assertThat(fx.generationOf(agent)).isEqualTo(deferred);
    assertThat(desiredEvents()).containsExactly(new AgentRuntimeDesiredChanged(1L, loc));
    // 「지금 적용」도 다른 실행 설정 변경처럼 감사 로그를 남긴다.
    assertThat(appliedNowAudits(agent)).isOne();
  }

  /**
   * 미뤄 둔 generation 이 없으면 같은 설정을 NOW 로 다시 저장해도 apply_mode·generation 이 그대로이고 runner 에 알리지
   * 않는다(WP-1515).
   */
  @Test
  void put_whenUnchangedWithApplyNowAndNothingDeferred_isNoop() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent).andExpect(status().isOk());
    action(agent, "start").andExpect(status().isOk());
    setWorkingAtCurrentGeneration(agent);
    long generation = fx.generationOf(agent);
    appEvents.clear();

    putSetting(agent, "{\"templateName\":\"claude-code\",\"config\":{},\"applyMode\":\"NOW\"}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.applyMode").value("IDLE"))
        .andExpect(jsonPath("$.generation").value(generation));

    assertThat(applyModeOf(agent)).isEqualTo("IDLE");
    assertThat(desiredEvents()).isEmpty();
    assertThat(appliedNowAudits(agent)).isZero();
  }

  /** 「지금 적용」 감사 로그 수(WP-1515). */
  private int appliedNowAudits(long agent) {
    TenantContext.set(1L);
    return dsl.fetchCount(
        AUDIT_LOG,
        AUDIT_LOG
            .ACTION_TYPE
            .eq("AGENT_RUNTIME_APPLIED_NOW")
            .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(agent))));
  }

  /** 지금 Pod 가 지금 generation 으로 일하는 중이라고 관찰 칸을 맞춘다(apply_mode IDLE). */
  private void setWorkingAtCurrentGeneration(long agent) {
    TenantContext.set(1L);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, AGENT_RUNTIME_SETTING.GENERATION)
        .set(AGENT_RUNTIME_SETTING.PHASE, "RUNNING")
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "WORKING")
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private String applyModeOf(long agent) {
    TenantContext.set(1L);
    return dsl.select(AGENT_RUNTIME_SETTING.APPLY_MODE)
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .fetchOne(AGENT_RUNTIME_SETTING.APPLY_MODE);
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

  /**
   * 실행에 실패한(FAILED) AI 를 「켜기」하면 다시 시작과 같다 — generation+1·바로 적용(NOW)·다시 시작 감사 기록·runner 알림. 어느 화면의
   * 켜기든 실패한 AI 를 다시 띄우게 한다.
   */
  @Test
  void start_whenRunningButFailed_restarts() throws Exception {
    long loc = newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start").andExpect(status().isOk());
    long g = fx.generationOf(agent);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, g)
        .set(AGENT_RUNTIME_SETTING.PHASE, "FAILED")
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    appEvents.clear();

    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.desired").value("RUN"))
        .andExpect(jsonPath("$.generation").value(g + 1))
        .andExpect(jsonPath("$.applyMode").value("NOW"))
        .andExpect(jsonPath("$.status").value("STARTING"));
    assertThat(desiredEvents()).containsExactly(new AgentRuntimeDesiredChanged(1L, loc));
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .ACTION_TYPE
                    .eq("AGENT_RUNTIME_RESTARTED")
                    .and(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(agent)))))
        .isOne();

    // 다시 띄우는 중(실패가 아님)이면 켜기는 다시 변화 없음.
    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.generation").value(g + 1));
  }

  /**
   * 켠 AI 를 새 설정이 미뤄진(관찰 generation 이 하나 뒤처진, 쉴 때 적용) 상태로 만든다 — phase·AI 상태는 호출자가 정한다. 도는 Pod 가 있는
   * 상태(시작 시각 있음)다 — Pod 가 없는 실패는 runner 가 바로 새로 만들어 쉴 때로 미룬 실패가 아니므로(WP-2000 코드 리뷰) 따로 시험한다.
   */
  private long runningBehind(String phase, String agentState) throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start").andExpect(status().isOk());
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, fx.generationOf(agent) - 1)
        .set(AGENT_RUNTIME_SETTING.PHASE, phase)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, agentState)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, "IDLE")
        .set(AGENT_RUNTIME_SETTING.STARTED_AT, OffsetDateTime.now().minusHours(1))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    return agent;
  }

  /** 시작 실패 뒤 새 설정이 미뤄졌는데 하던 일이 없으면 지금 적용 — 응답은 판정(NOW)과 「다시 뜨는 중」(STARTING)을 함께 준다(WP-2000). */
  @Test
  void get_whenFailedAndNoWork_pendingNowAndStarting() throws Exception {
    long agent = runningBehind("FAILED", null);

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").value("NOW"))
        .andExpect(jsonPath("$.status").value("STARTING"));
  }

  /** 하던 일이 있으면 끊지 않는다 — 판정은 AT_IDLE 이고 실패는 그대로 보인다(WP-2000). */
  @Test
  void get_whenFailedAndWorking_pendingAtIdleAndFailed() throws Exception {
    long agent = runningBehind("FAILED", "WORKING");

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").value("AT_IDLE"))
        .andExpect(jsonPath("$.status").value("FAILED"));
  }

  /**
   * Pod 를 만들지 못한 실패(FAILED·시작 시각 없음)는 하던 일이 있어 보여도 runner 가 바로 새 설정으로 만든다 — 화면은 지금 적용(NOW)·「다시 뜨는
   * 중」 (STARTING)으로 안내하고 계정 변경도 바로 적용이다(WP-2000 코드 리뷰). runner 응답 applyNow 는 RunnerApiTest 가 그대로
   * 거짓임을 지킨다.
   */
  @Test
  void get_whenFailedWithoutPodAndWorking_pendingNowAndStarting() throws Exception {
    long agent = runningBehind("FAILED", "WORKING");
    dsl.update(AGENT_RUNTIME_SETTING)
        .setNull(AGENT_RUNTIME_SETTING.STARTED_AT)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").value("NOW"))
        .andExpect(jsonPath("$.status").value("STARTING"))
        .andExpect(jsonPath("$.accountChangeAppliesNow").value(true));
  }

  /**
   * 도는 Pod 의 컨테이너가 시작에 실패했고 일이 없으면(WP-1969) 판정은 NOW — 차단이 지금 도는 Pod(관찰 generation)의 것이라 화면에도 「오류」로
   * 보인다(WP-1968 5차 반려 ③: 차단 저장은 보고한 generation 그대로 두고, 화면 판정만 관찰 generation 을 더 견준다 — 「쉴 때 적용」 대기 중
   * 도는 Pod 의 실패를 감추면 관리자가 시작 실패 사유를 보지 못한다).
   */
  @Test
  void get_whenBlockedRunningPodAndNoWork_pendingNowAndFailed() throws Exception {
    long agent = runningBehind("RUNNING", null);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "시작 실패")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, fx.generationOf(agent) - 1)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").value("NOW"))
        .andExpect(jsonPath("$.status").value("FAILED"));
  }

  /**
   * 새 설정(generation 4)으로 다시 뜬 Pod 의 진입점이 차단을 보고했는데 runner 관찰은 아직 옛 generation(3)이면, 판정은 「쉴 때 적용」이
   * 아니라 없음이다 — 눌러도 runner 가 같은 generation 이라 아무것도 하지 않는 「지금 적용」을 권하지 않는다. 어느 phase 에서도 같다(WP-2000
   * 최종 리뷰).
   */
  @Test
  void get_whenNewGenerationBlockedBeforeObserved_pendingNull() throws Exception {
    long agent = runningBehind("RUNNING", null);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE, "시작 실패")
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT, OffsetDateTime.now())
        .set(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION, fx.generationOf(agent))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    for (String phase : List.of("RUNNING", "STARTING", "STOPPING")) {
      dsl.update(AGENT_RUNTIME_SETTING)
          .set(AGENT_RUNTIME_SETTING.PHASE, phase)
          .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
          .execute();

      call(get(base(agent)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.pendingApply").doesNotExist())
          .andExpect(jsonPath("$.status").value("FAILED"));
    }
  }

  /** 꺼져 있으면 Pod 에 닿을 설정이 없어 pendingApply 는 null, 계정 변경은 바로 반영이다(WP-2000). */
  @Test
  void get_whenStopped_pendingNull() throws Exception {
    long agent = newAgent();
    putClaude(agent);

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.pendingApply").doesNotExist())
        .andExpect(jsonPath("$.accountChangeAppliesNow").value(true));
  }

  /** 하던 일 때문에 미룬 실패에 「켜기」를 눌러도 다시 시작하지 않는다 — generation·apply_mode 그대로, 실패는 그대로 보인다(WP-2000). */
  @Test
  void start_whenFailureHeldUntilIdle_changesNothing() throws Exception {
    long agent = runningBehind("FAILED", "WORKING");
    long g = fx.generationOf(agent);

    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.generation").value(g))
        .andExpect(jsonPath("$.applyMode").value("IDLE"))
        .andExpect(jsonPath("$.status").value("FAILED"));
    assertThat(fx.generationOf(agent)).isEqualTo(g);
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

  private ResultActions putAcceptNewWork(long agent, String body) throws Exception {
    return call(
        put(base(agent) + "/accept-new-work")
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  /** 요약 목록에서 이 AI 의 acceptNewWork 값. */
  private boolean summaryAcceptNewWork(long agent) throws Exception {
    String json =
        call(get("/api/v1/admin/agent-runtime-summaries"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    for (tools.jackson.databind.JsonNode n : om.readTree(json)) {
      if (n.get("agentUserId").asLong() == agent) return n.get("acceptNewWork").asBoolean();
    }
    throw new AssertionError("요약에 AI 가 없음: " + agent);
  }

  /** 새 설정의 「새 작업 받기」 기본은 true — 설정·요약 모두. */
  @Test
  void acceptNewWork_defaultsTrue() throws Exception {
    long agent = newAgent();
    putClaude(agent);

    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.acceptNewWork").value(true));
    assertThat(summaryAcceptNewWork(agent)).isTrue();
  }

  /** 값을 false 로 바꿔도 generation·desired·applyMode 는 그대로(AI 를 다시 띄우지 않는다), runner 이벤트도 없다. */
  @Test
  void putAcceptNewWork_false_keepsGenerationAndDesired() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start");
    var before = om.readTree(call(get(base(agent))).andReturn().getResponse().getContentAsString());
    int eventsBefore = desiredEvents().size();
    long adminEventsBefore = adminEvents();

    putAcceptNewWork(agent, "{\"acceptNewWork\":false}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.acceptNewWork").value(false))
        .andExpect(jsonPath("$.generation").value(before.get("generation").asLong()))
        .andExpect(jsonPath("$.desired").value(before.get("desired").asString()))
        .andExpect(jsonPath("$.applyMode").value(before.get("applyMode").asString()));

    assertThat(summaryAcceptNewWork(agent)).isFalse();
    assertThat(desiredEvents()).hasSize(eventsBefore);
    // 관리자 화면 갱신 알림은 한 번 나간다.
    assertThat(adminEvents()).isEqualTo(adminEventsBefore + 1);
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG, AUDIT_LOG.ACTION_TYPE.eq("AGENT_RUNTIME_ACCEPT_NEW_WORK_CHANGED")))
        .isEqualTo(1);
  }

  /** 다시 시작은 「새 작업 받기」 값을 유지한다. */
  @Test
  void restart_keepsAcceptNewWork() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start");
    putAcceptNewWork(agent, "{\"acceptNewWork\":false}").andExpect(status().isOk());

    action(agent, "restart")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.acceptNewWork").value(false));
  }

  /** 종료하면 true 로 되돌아가고, 다시 켜도 true 다. */
  @Test
  void stopThenStart_resetsAcceptNewWorkTrue() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start");
    putAcceptNewWork(agent, "{\"acceptNewWork\":false}").andExpect(status().isOk());
    action(agent, "stop")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.acceptNewWork").value(true));
    assertThat(summaryAcceptNewWork(agent)).isTrue();

    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.acceptNewWork").value(true));
  }

  /** 실행 설정이 없으면 404. */
  @Test
  void putAcceptNewWork_noSetting_404() throws Exception {
    long agent = newAgent();

    putAcceptNewWork(agent, "{\"acceptNewWork\":false}").andExpect(status().isNotFound());
  }

  /** ADMIN 이 아니면 403. */
  @Test
  void putAcceptNewWork_nonAdmin_403() throws Exception {
    long agent = newAgent();
    putClaude(agent);
    long member = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));

    TenantContext.set(1L);
    mvc.perform(
            put(base(agent) + "/accept-new-work")
                .with(authentication(auth(member)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"acceptNewWork\":false}"))
        .andExpect(status().isForbidden());
    TenantContext.set(1L);
  }

  /** 값이 없으면 400. */
  @Test
  void putAcceptNewWork_nullBody_400() throws Exception {
    long agent = newAgent();
    putClaude(agent);

    putAcceptNewWork(agent, "{}").andExpect(status().isBadRequest());
  }

  private ResultActions putSlotLimit(long agent, String body) throws Exception {
    return call(
        put(base(agent) + "/slot-limit").contentType(MediaType.APPLICATION_JSON).content(body));
  }

  /** 동시 진행 상한(WP-1754) — 덮어쓴 값이 없으면 템플릿 기본값(genia-code 1, claude-code 5)이 효과값이다. */
  @Test
  void slotLimit_defaultsFromTemplate() throws Exception {
    long genia = newAgent();
    putSetting(genia, "{\"templateName\":\"genia-code\",\"config\":{}}").andExpect(status().isOk());
    call(get(base(genia)))
        .andExpect(jsonPath("$.slotLimit").doesNotExist())
        .andExpect(jsonPath("$.defaultSlotLimit").value(1))
        .andExpect(jsonPath("$.effectiveSlotLimit").value(1));

    long claude = newAgent();
    putClaude(claude);
    call(get(base(claude)))
        .andExpect(jsonPath("$.defaultSlotLimit").value(5))
        .andExpect(jsonPath("$.effectiveSlotLimit").value(5));
  }

  /** 상한 변경은 generation·runner 알림 없이 값만 바꾸고 감사 1건·관리자 알림 1건을 남긴다. null 은 기본으로 되돌린다. */
  @Test
  void slotLimit_putChangesWithoutGeneration() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();
    putClaude(agent);
    action(agent, "start");
    var before = om.readTree(call(get(base(agent))).andReturn().getResponse().getContentAsString());
    int eventsBefore = desiredEvents().size();
    long adminEventsBefore = adminEvents();

    putSlotLimit(agent, "{\"slotLimit\":2}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.slotLimit").value(2))
        .andExpect(jsonPath("$.effectiveSlotLimit").value(2))
        .andExpect(jsonPath("$.generation").value(before.get("generation").asLong()));

    assertThat(desiredEvents()).hasSize(eventsBefore);
    assertThat(adminEvents()).isEqualTo(adminEventsBefore + 1);
    assertThat(
            dsl.fetchCount(AUDIT_LOG, AUDIT_LOG.ACTION_TYPE.eq("AGENT_RUNTIME_SLOT_LIMIT_CHANGED")))
        .isEqualTo(1);

    putSlotLimit(agent, "{\"slotLimit\":null}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.slotLimit").doesNotExist())
        .andExpect(jsonPath("$.effectiveSlotLimit").value(5));
  }

  /** 1·2·3·5 밖의 값은 400 이고 행은 그대로, 설정이 없는 AI 는 404. */
  @Test
  void slotLimit_rejectsOutOfRange() throws Exception {
    long agent = newAgent();
    putClaude(agent);

    putSlotLimit(agent, "{\"slotLimit\":4}").andExpect(status().isBadRequest());
    putSlotLimit(agent, "{\"slotLimit\":0}").andExpect(status().isBadRequest());
    call(get(base(agent))).andExpect(jsonPath("$.slotLimit").doesNotExist());

    putSlotLimit(newAgent(), "{\"slotLimit\":2}").andExpect(status().isNotFound());
  }

  /** 설정 PUT(템플릿 바꾸기)은 사람이 바꾼 상한을 건드리지 않는다. */
  @Test
  void slotLimit_survivesTemplateChange() throws Exception {
    long agent = newAgent();
    putClaude(agent);
    putSlotLimit(agent, "{\"slotLimit\":3}").andExpect(status().isOk());

    putSetting(agent, "{\"templateName\":\"genia-code\",\"config\":{}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.slotLimit").value(3))
        .andExpect(jsonPath("$.effectiveSlotLimit").value(3))
        .andExpect(jsonPath("$.defaultSlotLimit").value(1));
  }

  /** AI 에게 작업 중(WORKING) 작업 한 건을 지금 시각으로 만든다 — 무소식(stale)이 아니어야 자리로 센다(WP-1775). */
  private void seedWorkingWork(long agent) {
    TenantContext.set(1L);
    String key = "SU" + UUID.randomUUID().toString().replace("-", "").toUpperCase().substring(0, 6);
    long project = projectService.create(admin, new CreateProjectRequest(key, "P-su", "x")).id();
    long issueId =
        IssueSeeds.insert(issueRepository, baseDsl, project, 1, "작업", null, "MID", null, admin)
            .id();
    OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, agent)
        .set(AGENT_WORK.TOOL, "claude-code")
        .set(AGENT_WORK.STATE, "WORKING")
        .set(AGENT_WORK.UPDATED_AT, now)
        .set(AGENT_WORK.STATE_CHANGED_AT, now)
        .execute();
  }

  /** AI별 현황(/me/ai-agents?scope=ALL)에서 이 AI 의 slotsUsed. */
  private int rosterSlotsUsed(long agent) throws Exception {
    String body =
        call(get("/api/v1/me/ai-agents?scope=ALL"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    for (JsonNode a : om.readTree(body).get("agents")) {
      if (a.get("agent").get("id").asLong() == agent) return a.get("slotsUsed").asInt();
    }
    throw new AssertionError("AI " + agent + " 가 AI별 현황에 없다: " + body);
  }

  /** AI 한 명의 자리 조회(WP-1775) 호출. */
  private ResultActions getSlots(long agent) throws Exception {
    return call(get(base(agent) + "/slots"));
  }

  /**
   * AI 한 명의 자리 조회(WP-1775) — 에이전트 상세가 전체 AI 목록을 읽지 않고 이 값으로 「지금 n개 진행 중」을 그린다. used 는 AI별 현황
   * slotsUsed 와, limit 은 실행 설정의 effectiveSlotLimit 과 같은 기준이어야 한다.
   */
  @Test
  void slots_matchRosterAndEffectiveLimit() throws Exception {
    long agent = newAgent();
    putClaude(agent).andExpect(status().isOk());
    getSlots(agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.used").value(0))
        .andExpect(jsonPath("$.limit").value(5));
    seedWorkingWork(agent);

    int roster = rosterSlotsUsed(agent);
    assertThat(roster).isEqualTo(1);
    getSlots(agent).andExpect(jsonPath("$.used").value(roster));
    // 상한을 바꾸면 limit 도 실행 설정의 effectiveSlotLimit 과 같이 바뀐다.
    putSlotLimit(agent, "{\"slotLimit\":2}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.effectiveSlotLimit").value(2));
    getSlots(agent)
        .andExpect(jsonPath("$.used").value(roster))
        .andExpect(jsonPath("$.limit").value(2));
  }

  /** 실행 설정 행이 없는 AI 도 200 — used 0, limit 기본(WP-1775). */
  @Test
  void slots_withoutSetting_returnsDefault() throws Exception {
    getSlots(newAgent())
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.used").value(0))
        .andExpect(jsonPath("$.limit").value(5));
  }

  /** 이 워크스페이스 구성원이 아닌 AI 는 기존 조회처럼 404(WP-1775). */
  @Test
  void slots_nonMember_returns404() throws Exception {
    long outsider = TestFixtures.createAgentNoToken(dsl);
    call(get(base(outsider))).andExpect(status().isNotFound());
    getSlots(outsider).andExpect(status().isNotFound());
  }

  /** 구성원이어도 사람이면 자리가 없으니 404 — AI 에게만 답한다(WP-1775). */
  @Test
  void slots_human_returns404() throws Exception {
    getSlots(admin).andExpect(status().isNotFound());
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
        // 저장된 키가 없던 칸(queue)은 켤 때 기본값으로 채워진다(WP-1344).
        .andExpect(jsonPath("$.config.queue").value("AI 개발팀"))
        .andExpect(jsonPath("$.config.retired").doesNotExist());
  }

  /** 선택 칸(queue)을 비워 저장하면 기본값이 아닌 ""로 남고, 켠 뒤(repinConfig)에도 유지된다(WP-1344). */
  @Test
  void put_whenOptionalQueueBlank_staysEmptyAcrossStart() throws Exception {
    newLocation("운영", 3);
    long agent = newAgent();

    putSetting(
            agent,
            "{\"templateName\":\"claude-code\",\"config\":{\"model\":\"opus\",\"queue\":\"\"}}")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.config.queue").value(""));
    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.config.queue").value(""));

    action(agent, "start")
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.config.queue").value(""));
    call(get(base(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.config.queue").value(""));
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
