package com.workplace.agentaccount;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT_BINDING;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import com.workplace.wiki.service.WikiSpaceService;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-1448 AI → 계정 묶기 관리자 API 통합 테스트 — 작업 공간(Pod) AI 를 템플릿에 맞는 계정에 묶고(조회 포함), 실행 설정 없는 AI(409)·맞지 않는
 * 종류(400)·개인 비서(400)·다른 워크스페이스 계정(404)을 거절하며, 풀기는 멱등(204)이다. 키 값은 모두 가짜다.
 */
@Transactional
class AgentAccountBindingApiTest extends IntegrationTestBase {

  private static final String TOKEN = "sk-ant-oat01-" + "B".repeat(40);

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired WikiSpaceService wikiSpaceService;
  @Autowired AgentLocationService locationService;
  @Autowired ObjectMapper om;

  private long admin;

  /** 워크스페이스 1 의 관리자를 시드한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
  }

  private static String url(long agent) {
    return "/api/v1/admin/agents/" + agent + "/agent-account";
  }

  /** 웹 로그인 세션 인증(user:write) — 쓰기 API 가 @RequireWebSession 이다. */
  private Authentication auth() {
    return WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 요청 필터가 끝나면 TenantContext 가 비워지므로 매 호출 전·후에 테넌트를 다시 맞춘다. */
  private ResultActions call(MockHttpServletRequestBuilder b) throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(b.with(authentication(auth())));
    useTenant(1L);
    return r;
  }

  private ResultActions bind(long agent, long accountId) throws Exception {
    return call(
        put(url(agent))
            .contentType(MediaType.APPLICATION_JSON)
            .content("{\"accountId\":" + accountId + "}"));
  }

  /** 이 워크스페이스 AI 를 만든다 — template 이 null 이면 실행 설정을 두지 않는다(기본 방식). */
  private long newAgent(String template) {
    useTenant(1L);
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    if (template != null) {
      settingService.put(
          admin, agent, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
    }
    return agent;
  }

  private long anthropicAccount() {
    return accountService
        .register(admin, new AgentAccountRequest("anthropic", TOKEN, null, "팀 구독", null, null))
        .id();
  }

  @Test
  void bindPodAgentToFittingAccount() throws Exception {
    long agent = newAgent("claude-code");
    long acc = anthropicAccount();

    bind(agent, acc)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(acc))
        .andExpect(jsonPath("$.agents[0].userId").value(agent));

    call(get(url(agent)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.id").value(acc))
        .andExpect(jsonPath("$.provider").value("anthropic"));
  }

  @Test
  void bindRequiresPodMode() throws Exception {
    long agent = newAgent(null);
    long acc = anthropicAccount();

    bind(agent, acc)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.message").value("작업 공간 실행 방식 AI 만 계정을 고를 수 있어요"));
    call(get(url(agent))).andExpect(status().isNotFound());
  }

  @Test
  void bindRejectsUnfitProvider() throws Exception {
    long agent = newAgent("test-chatgpt");
    long acc = anthropicAccount();

    bind(agent, acc)
        .andExpect(status().isBadRequest())
        .andExpect(
            jsonPath("$.message").value("이 AI 의 실행 템플릿은 「ChatGPT 로그인」 계정을 써요 — 그 계정으로 연결해 주세요."));
  }

  @Test
  void bindPersonalAssistantRejected() throws Exception {
    useTenant(1L);
    long assistant =
        TestFixtures.activeMemberOfCurrentTenant(
            dsl, TestFixtures.createPersonalAssistant(dsl, admin));
    long acc = anthropicAccount();

    bind(assistant, acc).andExpect(status().isBadRequest());
  }

  @Test
  void bindOtherTenantAccountIsNotFound() throws Exception {
    long agent = newAgent("claude-code");
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);
    long foreign =
        accounts.insert(
            "anthropic", "남의 계정", "iv:cipher", null, null, "ACTIVE", null, null, false, null);
    useTenant(1L);

    bind(agent, foreign)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_NOT_FOUND"));
    call(get(url(agent))).andExpect(status().isNotFound());
  }

  @Test
  void unbindIsIdempotent() throws Exception {
    long agent = newAgent("claude-code");
    long acc = anthropicAccount();
    bind(agent, acc).andExpect(status().isOk());

    call(delete(url(agent))).andExpect(status().isNoContent());
    call(delete(url(agent))).andExpect(status().isNoContent());

    call(get(url(agent)))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_NOT_BOUND"));
  }

  /**
   * 리뷰 수정(WP-1448) — 지울 수 없는(기록이 남은) 계정 묶인 AI 를 삭제하면 사용 중지로 끝나고, 이 워크스페이스의 묶음도 풀린다. 묶음이 남으면 계정 폐기가
   * 「쓰는 AI 있음」 409 로 막히고, 다시 켜면 그 계정 키가 다시 간다.
   */
  @Test
  void deactivatingAgentUnbindsItsAccount() throws Exception {
    long agent = newAgent("claude-code");
    long acc = anthropicAccount();
    bind(agent, acc).andExpect(status().isOk());
    // 개인 노트 공간 — wiki_space.owner_id 가 user 를 NO ACTION 으로 가리켜 완전 삭제를 막는다(AdminAgentDeleteTest 와 같은
    // 방법).
    useTenant(1L);
    wikiSpaceService.ensurePersonalSpace(agent);

    call(delete("/api/v1/admin/agents/" + agent))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.result").value("DEACTIVATED"));

    assertThat(dsl.fetchCount(AGENT_ACCOUNT_BINDING, AGENT_ACCOUNT_BINDING.AGENT_USER_ID.eq(agent)))
        .isZero();
    call(delete("/api/v1/admin/agent-accounts/" + acc)).andExpect(status().isNoContent());
  }

  /**
   * 계정 변경이 지금 적용되는지(WP-2000) — 상세 GET 의 {@code accountChangeAppliesNow} 가 기대값과 같고, 켜진 AI 는 실제로 계정을
   * 바꾼 뒤 runner 의 desired {@code applyNow} 와도 같다(화면의 예고와 실제 적용이 한 판정이라는 계약). 인자는 이름, 꺼짐 여부, 관찰
   * phase, AI 상태, 설정이 뒤처졌는지(걸려 있는 NOW 포함), 이미 반영된 NOW 인지(apply_mode NOW 인데 관찰 generation =
   * generation), 기대값.
   */
  @ParameterizedTest(name = "{0}")
  @MethodSource("rotationCases")
  void accountChangeAppliesNow_matchesRotationDecision(
      String name,
      boolean stopped,
      String phase,
      String agentState,
      boolean pendingNow,
      boolean appliedNow,
      boolean expected)
      throws Exception {
    useTenant(1L);
    String runnerToken =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .plaintextToken();
    long agent = newAgent("claude-code");
    if (!stopped) settingService.start(admin, agent);
    long generation =
        dsl.select(AGENT_RUNTIME_SETTING.GENERATION)
            .from(AGENT_RUNTIME_SETTING)
            .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
            .fetchOne(AGENT_RUNTIME_SETTING.GENERATION);
    if (!stopped) {
      dsl.update(AGENT_RUNTIME_SETTING)
          .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, pendingNow ? generation - 1 : generation)
          .set(AGENT_RUNTIME_SETTING.PHASE, phase)
          .set(AGENT_RUNTIME_SETTING.AGENT_STATE, agentState)
          .set(AGENT_RUNTIME_SETTING.APPLY_MODE, pendingNow || appliedNow ? "NOW" : "IDLE")
          // 도는 Pod 가 있는 상태 — Pod 가 없는 실패는 runner 가 바로 만들어 따로 시험한다(WP-2000 코드 리뷰).
          .set(AGENT_RUNTIME_SETTING.STARTED_AT, OffsetDateTime.now().minusHours(1))
          .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
          .execute();
    }

    String body =
        call(get("/api/v1/admin/agents/" + agent + "/runtime-setting"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(om.readTree(body).get("accountChangeAppliesNow").asBoolean()).isEqualTo(expected);
    if (stopped) return;

    // 켜진 AI 는 실제로 계정을 바꿔 보고, runner 가 받는 applyNow 가 예고와 같은지 본다.
    bind(agent, anthropicAccount()).andExpect(status().isOk());
    useTenant(1L);
    JsonNode desired =
        om.readTree(
            mvc.perform(
                    get("/api/v1/agent-runtime/runner/desired")
                        .header("Authorization", "Bearer " + runnerToken))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    useTenant(1L);
    assertThat(desired.get("agents").get(0).get("applyNow").asBoolean()).isEqualTo(expected);
  }

  /**
   * Pod 를 만들지 못한 실패(FAILED·시작 시각 없음)는 일하는 것으로 보여도 화면의 계정 변경 예고가 「바로 적용」이다 — runner 는 Pod 가 없으면 지금
   * desired 로 만들기 때문이다(WP-2000 코드 리뷰). 반면 runner 응답 {@code applyNow} 는 일하는 AI 를 끊지 않도록 그대로 거짓이다.
   */
  @Test
  void accountChangeAppliesNow_whenFailedWithoutPodAndWorking_trueButRunnerApplyNowFalse()
      throws Exception {
    useTenant(1L);
    String runnerToken =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .plaintextToken();
    long agent = newAgent("claude-code");
    settingService.start(admin, agent);
    long generation =
        dsl.select(AGENT_RUNTIME_SETTING.GENERATION)
            .from(AGENT_RUNTIME_SETTING)
            .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
            .fetchOne(AGENT_RUNTIME_SETTING.GENERATION);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION, generation)
        .set(AGENT_RUNTIME_SETTING.PHASE, "FAILED")
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, "WORKING")
        .setNull(AGENT_RUNTIME_SETTING.STARTED_AT)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    String body =
        call(get("/api/v1/admin/agents/" + agent + "/runtime-setting"))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(om.readTree(body).get("accountChangeAppliesNow").asBoolean()).isTrue();

    bind(agent, anthropicAccount()).andExpect(status().isOk());
    useTenant(1L);
    JsonNode desired =
        om.readTree(
            mvc.perform(
                    get("/api/v1/agent-runtime/runner/desired")
                        .header("Authorization", "Bearer " + runnerToken))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    useTenant(1L);
    assertThat(desired.get("agents").get(0).get("applyNow").asBoolean()).isFalse();
  }

  static Stream<Arguments> rotationCases() {
    return Stream.of(
        Arguments.of("쉬는 중", false, "RUNNING", "IDLE", false, false, true),
        Arguments.of("일하는 중", false, "RUNNING", "WORKING", false, false, false),
        Arguments.of("관찰 실패 + 일 없음", false, "FAILED", null, false, false, true),
        Arguments.of("관찰 실패 + 일함", false, "FAILED", "WORKING", false, false, false),
        Arguments.of("꺼짐", true, null, null, false, false, true),
        Arguments.of("걸려 있는 NOW", false, "RUNNING", "WORKING", true, false, true),
        Arguments.of("이미 반영된 NOW + 일함", false, "RUNNING", "WORKING", false, true, false));
  }
}
