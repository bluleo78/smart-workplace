package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountBindingService;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1448 runner 계약 통합 테스트 — 작업 공간 AI 가 계정에 묶이면 runner 가 받는 desired 의 claude·login 버전과
 * /secrets/claude·/secrets/login 원문이 「AI 의 활성 연결」 대신 「묶인 계정」에서 나온다.
 *
 * <ul>
 *   <li>같은 계정을 쓰는 AI 들은 같은 버전·같은 원문을 받는다(버전 = 계정 secret_version).
 *   <li>묶인 계정이 활성 연결보다 먼저, 묶이지 않았으면 지금처럼 활성 연결.
 *   <li>계정 원문을 교체하면 그 계정을 쓰는 모든 AI 의 버전이 바뀌고, 한 AI 만 다른 계정으로 옮기면 다른 AI 의 버전은 그대로다.
 *   <li>묶기·옮기기·원문 교체는 runner 에 「다시 받아 가라」를 알린다.
 * </ul>
 *
 * <p>runner 토큰·템플릿 준비는 {@code AgentLoginAccountApiTest} 를 따른다. 모든 키 값은 가짜다.
 */
@Transactional
@RecordApplicationEvents
class RunnerAccountContractTest extends IntegrationTestBase {

  private static final String RUNNER = "/api/v1/agent-runtime/runner";
  private static final String LOGIN_TEMPLATE = "test-chatgpt";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AiAgentCredentialService credentials;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountBindingService bindingService;
  @Autowired AgentAccountRepository accounts;
  @Autowired ApplicationEvents appEvents;

  private long admin;
  private String runnerToken;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    runnerToken =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .plaintextToken();
  }

  // ---- 준비 도우미 ----

  /** 가짜 Codex auth.json — account_id 가 계정 정체성(지문)이고 refresh 로 원문을 가른다. */
  private static String chatgptLogin(String accountId, String refresh) {
    Base64.Encoder enc = Base64.getUrlEncoder().withoutPadding();
    String idToken =
        enc.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8))
            + "."
            + enc.encodeToString("{\"email\":\"c@example.test\"}".getBytes(StandardCharsets.UTF_8))
            + ".sig";
    return "{\"auth_mode\":\"chatgpt\",\"OPENAI_API_KEY\":null,\"tokens\":{\"id_token\":\""
        + idToken
        + "\",\"access_token\":\"fake-access\",\"refresh_token\":\""
        + refresh
        + "\",\"account_id\":\""
        + accountId
        + "\"}}";
  }

  private static String claudeToken(char c) {
    return "sk-ant-oat01-" + String.valueOf(c).repeat(40);
  }

  /** 템플릿 실행 설정을 둔 AI(꺼진 채). */
  private long agentWith(String template) {
    useTenant(1L);
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
    return agent;
  }

  /** 원하는 상태를 RUN 으로 바로 바꾼다 — 켜기 전 로그인 확인은 지금 활성 연결만 보므로(계정으로 켜기는 후속 작업) 계약만 보려고 행을 직접 고친다. */
  private void run(long agent) {
    useTenant(1L);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.DESIRED, "RUN")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private long chatgptAccount(String accountId, String refresh) {
    return accountService
        .register(
            admin,
            new AgentAccountRequest(
                "chatgpt", null, null, null, chatgptLogin(accountId, refresh), null))
        .id();
  }

  private long anthropicAccount(char c) {
    return accountService
        .register(
            admin, new AgentAccountRequest("anthropic", claudeToken(c), null, null, null, null))
        .id();
  }

  private long secretVersion(long accountId) {
    useTenant(1L);
    return accounts.findActive(accountId).orElseThrow().secretVersion();
  }

  private void bind(long agent, long accountId) {
    useTenant(1L);
    bindingService.bind(admin, agent, accountId);
  }

  private long desiredChangedEvents() {
    return appEvents.stream(AgentRuntimeDesiredChanged.class).count();
  }

  // ---- runner 호출 도우미 ----

  private ResultActions runner(MockHttpServletRequestBuilder b) throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(b.header("Authorization", "Bearer " + runnerToken));
    useTenant(1L);
    return r;
  }

  private JsonNode desiredAgent(long agent) throws Exception {
    JsonNode body =
        om.readTree(
            runner(get(RUNNER + "/desired"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    for (JsonNode a : body.get("agents")) if (a.get("agentUserId").asLong() == agent) return a;
    throw new AssertionError("desired 에 AI 없음");
  }

  /** desired 의 비밀값 참조 버전(null 이면 Long null). */
  private Long desiredVersion(long agent, String secretName) throws Exception {
    for (JsonNode s : desiredAgent(agent).get("secrets")) {
      if (secretName.equals(s.get("name").asText())) {
        return s.get("version").isNull() ? null : s.get("version").asLong();
      }
    }
    throw new AssertionError("desired 에 비밀값 참조 없음: " + secretName);
  }

  /** /secrets/{kind} 응답 JSON. */
  private JsonNode secret(long agent, String kind) throws Exception {
    return om.readTree(
        runner(get(RUNNER + "/agents/" + agent + "/secrets/" + kind))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString());
  }

  // ---- 계약 ----

  @Test
  void twoAgentsShareAccountSameVersionAndSecret() throws Exception {
    // 로그인 계정(chatgpt) 하나에 AI 둘
    long login = chatgptAccount("acc-share", "refresh-share");
    long a = agentWith(LOGIN_TEMPLATE);
    long b = agentWith(LOGIN_TEMPLATE);
    bind(a, login);
    bind(b, login);
    run(a);
    run(b);

    long v = secretVersion(login);
    assertThat(desiredVersion(a, "login")).isEqualTo(v);
    assertThat(desiredVersion(b, "login")).isEqualTo(v);
    JsonNode sa = secret(a, "login");
    JsonNode sb = secret(b, "login");
    assertThat(sa.get("version").asLong()).isEqualTo(v);
    assertThat(sb.get("version").asLong()).isEqualTo(v);
    assertThat(sa.get("payload").asText()).isEqualTo(sb.get("payload").asText());
    assertThat(om.readTree(sa.get("payload").asText()).at("/tokens/refresh_token").asText())
        .isEqualTo("refresh-share");

    // Claude 구독 계정 하나에 claude-code AI 둘
    long claude = anthropicAccount('S');
    long c = agentWith("claude-code");
    long d = agentWith("claude-code");
    bind(c, claude);
    bind(d, claude);
    settingService.start(admin, c);
    settingService.start(admin, d);

    long cv = secretVersion(claude);
    assertThat(desiredVersion(c, "claude")).isEqualTo(cv);
    assertThat(desiredVersion(d, "claude")).isEqualTo(cv);
    JsonNode sc = secret(c, "claude");
    JsonNode sd = secret(d, "claude");
    assertThat(sc.get("version").asLong()).isEqualTo(cv);
    assertThat(sc.get("provider").asText()).isEqualTo("anthropic");
    assertThat(sc.get("payload").asText()).isEqualTo(claudeToken('S'));
    assertThat(sd.get("payload").asText()).isEqualTo(claudeToken('S'));
  }

  @Test
  void boundAccountWinsOverLegacyCredential() throws Exception {
    // Claude: 활성 연결이 있는 채 켠 AI 를 계정에 묶으면 계정 것
    long c = agentWith("claude-code");
    long legacyClaude =
        credentials.register(admin, c, "anthropic", claudeToken('L'), "legacy", null).id();
    settingService.start(admin, c);
    assertThat(desiredVersion(c, "claude")).isEqualTo(legacyClaude);

    long claude = anthropicAccount('A');
    long before = desiredChangedEvents();
    bind(c, claude);
    assertThat(desiredChangedEvents()).isGreaterThan(before);

    assertThat(desiredVersion(c, "claude")).isEqualTo(secretVersion(claude));
    assertThat(secret(c, "claude").get("payload").asText()).isEqualTo(claudeToken('A'));

    // 로그인: 활성 chatgpt 연결이 있어도 묶인 계정 것
    long g = agentWith(LOGIN_TEMPLATE);
    credentials.register(
        admin, g, "chatgpt", chatgptLogin("acc-legacy", "refresh-legacy"), "legacy", null);
    settingService.start(admin, g);
    long login = chatgptAccount("acc-bound", "refresh-bound");
    bind(g, login);

    assertThat(desiredVersion(g, "login")).isEqualTo(secretVersion(login));
    JsonNode s = secret(g, "login");
    assertThat(s.get("version").asLong()).isEqualTo(secretVersion(login));
    assertThat(om.readTree(s.get("payload").asText()).at("/tokens/refresh_token").asText())
        .isEqualTo("refresh-bound");
  }

  @Test
  void legacyCredentialUsedWhenUnbound() throws Exception {
    long c = agentWith("claude-code");
    long legacy =
        credentials.register(admin, c, "anthropic", claudeToken('L'), "legacy", null).id();
    settingService.start(admin, c);

    assertThat(desiredVersion(c, "claude")).isEqualTo(legacy);
    assertThat(secret(c, "claude").get("payload").asText()).isEqualTo(claudeToken('L'));

    // 묶었다 풀면 다시 활성 연결
    long claude = anthropicAccount('U');
    bind(c, claude);
    assertThat(desiredVersion(c, "claude")).isEqualTo(secretVersion(claude));
    long before = desiredChangedEvents();
    useTenant(1L);
    bindingService.unbindIfBound(admin, c);
    assertThat(desiredChangedEvents()).isGreaterThan(before);

    assertThat(desiredVersion(c, "claude")).isEqualTo(legacy);
    assertThat(secret(c, "claude").get("payload").asText()).isEqualTo(claudeToken('L'));
  }

  @Test
  void replacingAccountSecretChangesVersionForAllBoundAgents() throws Exception {
    long login = chatgptAccount("acc-rot", "refresh-old");
    long a = agentWith(LOGIN_TEMPLATE);
    long b = agentWith(LOGIN_TEMPLATE);
    bind(a, login);
    bind(b, login);
    run(a);
    run(b);
    long old = secretVersion(login);

    long before = desiredChangedEvents();
    useTenant(1L);
    accountService.update(
        admin,
        login,
        new AgentAccountUpdateRequest(
            null, null, null, chatgptLogin("acc-rot", "refresh-new"), null));
    assertThat(desiredChangedEvents()).isGreaterThan(before);

    long v = secretVersion(login);
    assertThat(v).isNotEqualTo(old);
    assertThat(desiredVersion(a, "login")).isEqualTo(v);
    assertThat(desiredVersion(b, "login")).isEqualTo(v);
    for (long agent : new long[] {a, b}) {
      JsonNode s = secret(agent, "login");
      assertThat(s.get("version").asLong()).isEqualTo(v);
      assertThat(om.readTree(s.get("payload").asText()).at("/tokens/refresh_token").asText())
          .isEqualTo("refresh-new");
    }
  }

  @Test
  void rebindingOneAgentLeavesOtherVersionUnchanged() throws Exception {
    long first = chatgptAccount("acc-1", "refresh-1");
    long second = chatgptAccount("acc-2", "refresh-2");
    long a = agentWith(LOGIN_TEMPLATE);
    long b = agentWith(LOGIN_TEMPLATE);
    bind(a, first);
    bind(b, first);
    run(a);
    run(b);
    long bBefore = desiredVersion(b, "login");

    long before = desiredChangedEvents();
    bind(a, second);
    assertThat(desiredChangedEvents()).isGreaterThan(before);

    assertThat(desiredVersion(a, "login")).isEqualTo(secretVersion(second));
    assertThat(desiredVersion(b, "login")).isEqualTo(bBefore).isEqualTo(secretVersion(first));
    assertThat(
            om.readTree(secret(a, "login").get("payload").asText())
                .at("/tokens/refresh_token")
                .asText())
        .isEqualTo("refresh-2");
    assertThat(
            om.readTree(secret(b, "login").get("payload").asText())
                .at("/tokens/refresh_token")
                .asText())
        .isEqualTo("refresh-1");
  }

  /**
   * OpenAI 호환 계정 — login 버전·원문은 활성 연결과 같은 함수(계정 버전 + 원문 + 그 AI 의 지정 모델)로 계산한다. 같은 계정이어도 AI 마다 지정
   * 모델이 다르면 버전이 다르고, desired 의 버전은 /secrets/login 의 버전과 같다.
   */
  @Test
  void opencodeAccountLoginVersionFollowsEachAgentsModel() throws Exception {
    long acc =
        accountService
            .register(
                admin,
                new AgentAccountRequest(
                    "opencode",
                    null,
                    new ProviderConfig(
                        "vllm",
                        null,
                        Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-fake")),
                    null,
                    null,
                    null))
            .id();
    long a = agentWith("opencode");
    long b = agentWith("opencode");
    configRepo.upsert(a, "vllm/qwen3", null, null, null);
    configRepo.upsert(b, "vllm/llama", null, null, null);
    bind(a, acc);
    bind(b, acc);
    run(a);
    run(b);

    long va = desiredVersion(a, "login");
    long vb = desiredVersion(b, "login");
    assertThat(va).isNotEqualTo(vb);
    JsonNode sa = secret(a, "login");
    assertThat(sa.get("version").asLong()).isEqualTo(va);
    assertThat(om.readTree(sa.get("payload").asText()).get("defaultModel").asText())
        .isEqualTo("vllm/qwen3");
    assertThat(secret(b, "login").get("version").asLong()).isEqualTo(vb);
  }
}
