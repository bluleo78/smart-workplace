package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.BooleanNode;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.exception.AgentRuntimeSettingConflictException;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.ProviderCredentialRegisterRequest;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.PersonalAssistantService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import com.workplace.user.dto.AgentRuntime;
import com.workplace.user.service.UserService;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1296·1297 로그인 정보 AI 계정 통합 테스트 — 실행 방식별 「맞는 계정」 등록 검사, 계정 이메일 메타, ai-agent redeem 거절, desired 의
 * login 참조·/secrets/login, 실행 방식 변경 때 맞지 않는 연결 끊기, 켜기 전 로그인 확인.
 *
 * <p>로그인 계정 템플릿은 테스트 전용 {@code test-chatgpt}(src/test/resources/agent-templates — requires
 * [chatgpt]). 모든 로그인 값은 가짜다.
 */
@Transactional
class AgentLoginAccountApiTest extends IntegrationTestBase {

  private static final String RUNNER = "/api/v1/agent-runtime/runner";
  private static final String LOGIN_TEMPLATE = "test-chatgpt";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AiAgentCredentialService credentials;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired EncryptionService encryption;
  @Autowired UserService userService;
  @Autowired PersonalAssistantService personalAssistants;

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

  /** 가짜 Codex auth.json — id_token 본문에 email 만 둔다. */
  private static String chatgptLogin(String email) {
    Base64.Encoder enc = Base64.getUrlEncoder().withoutPadding();
    String idToken =
        enc.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8))
            + "."
            + enc.encodeToString(("{\"email\":\"" + email + "\"}").getBytes(StandardCharsets.UTF_8))
            + ".sig";
    return "{\"auth_mode\":\"chatgpt\",\"OPENAI_API_KEY\":null,\"tokens\":{\"id_token\":\""
        + idToken
        + "\",\"access_token\":\"fake-access\",\"refresh_token\":\"fake-refresh\"}}";
  }

  private long newAgent() {
    TenantContext.set(1L);
    return TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
  }

  private void putTemplate(long agent, String template) {
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
  }

  private long registerChatgpt(long agent) {
    return credentials
        .register(admin, agent, "chatgpt", chatgptLogin("c@example.test"), "codex", null)
        .id();
  }

  /** OpenAI 호환(opencode) 연결 원문 — 가짜 값. 모델은 등록 인자로 따로 받아 assistant_config 에 저장된다. */
  private static final String OPENCODE_CONFIG =
      "{\"providerId\":\"vllm\",\"npm\":\"@ai-sdk/openai-compatible\","
          + "\"options\":{\"baseURL\":\"https://api.example.com/v1\",\"apiKey\":\"sk-fake-opencode\"}}";

  private long registerOpencode(long agent, String model) {
    return credentials.register(admin, agent, "opencode", OPENCODE_CONFIG, "vllm", model).id();
  }

  private long registerAnthropic(long agent) {
    return credentials.register(admin, agent, "anthropic", "T".repeat(64), "main", null).id();
  }

  /** 등록 검사를 건너뛰고 활성 연결을 바꿔 넣는다 — 「다른 종류의 연결이 남은」 상태를 만들 때만 쓴다. */
  private long forceCredential(long agent, String provider, String plaintext) {
    credentialRepo.revokeActive(agent);
    return credentialRepo.insert(agent, provider, encryption.encrypt(plaintext), "forced", admin);
  }

  private Optional<String> activeProvider(long agent) {
    return credentials.findActiveProvider(agent);
  }

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

  private static JsonNode secretNamed(JsonNode agent, String name) {
    for (JsonNode s : agent.get("secrets")) if (name.equals(s.get("name").asText())) return s;
    return null;
  }

  // ---- 등록 검사(맞는 계정) ----

  /** 기본(INTERNAL) 방식이면 로그인 정보 계정을 받지 않는다(400). */
  @Test
  void register_loginOnServerAgent_rejects() {
    long agent = newAgent();

    assertThatThrownBy(() -> registerChatgpt(agent))
        .isInstanceOf(InvalidProviderCredentialException.class)
        .hasMessageContaining("기본 실행 방식");
    assertThat(activeProvider(agent)).isEmpty();
  }

  /** 내 컴퓨터(EXTERNAL·실행 설정 없음)는 무엇이든 받는다. */
  @Test
  void register_loginOnExternalAgent_accepts() {
    long agent = newAgent();
    userService.setAgentRuntime(admin, agent, AgentRuntime.EXTERNAL);

    registerChatgpt(agent);

    assertThat(activeProvider(agent)).contains("chatgpt");
  }

  /** 작업 공간은 그 템플릿의 계정만 — claude-code 에 chatgpt, test-chatgpt 에 anthropic 은 400. */
  @Test
  void register_onWorkspace_acceptsOnlyTemplateAccount() {
    long claude = newAgent();
    putTemplate(claude, "claude-code");
    long codex = newAgent();
    putTemplate(codex, LOGIN_TEMPLATE);

    assertThatThrownBy(() -> registerChatgpt(claude))
        .isInstanceOf(InvalidProviderCredentialException.class)
        .hasMessageContaining("Claude 구독");
    assertThatThrownBy(() -> registerAnthropic(codex))
        .isInstanceOf(InvalidProviderCredentialException.class)
        .hasMessageContaining("ChatGPT 로그인");
    registerAnthropic(claude);
    registerChatgpt(codex);

    assertThat(activeProvider(claude)).contains("anthropic");
    assertThat(activeProvider(codex)).contains("chatgpt");
  }

  /** 관리자 API — loginInfo 로 등록하면 201·계정 이메일 메타(토큰 없음), 형식이 틀리면 400 에 값이 실리지 않는다. */
  @Test
  void adminRegister_withLoginInfo_returnsAccountEmailWithoutTokens() throws Exception {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    var auth = WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write")));
    String url = "/api/v1/admin/agents/" + agent + "/provider-credential";

    String ok =
        om.writeValueAsString(
            new ProviderCredentialRegisterRequest(
                "chatgpt", null, null, null, "codex", chatgptLogin("meta@example.test")));
    TenantContext.set(1L);
    String body =
        mvc.perform(
                post(url)
                    .with(authentication(auth))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(ok))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider").value("chatgpt"))
            .andExpect(jsonPath("$.account").value("meta@example.test"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(body).doesNotContain("fake-refresh").doesNotContain("fake-access");

    String bad =
        om.writeValueAsString(
            new ProviderCredentialRegisterRequest(
                "chatgpt",
                null,
                null,
                null,
                "codex",
                "{\"auth_mode\":\"apikey\",\"k\":\"SECRETX\"}"));
    TenantContext.set(1L);
    String err =
        mvc.perform(
                post(url)
                    .with(authentication(auth))
                    .contentType(MediaType.APPLICATION_JSON)
                    .content(bad))
            .andExpect(status().isBadRequest())
            .andReturn()
            .getResponse()
            .getContentAsString(StandardCharsets.UTF_8);
    assertThat(err).contains("ChatGPT 로 로그인한 정보가 아니에요").doesNotContain("SECRETX");
  }

  /** 저장값은 다듬은 JSON — 남는 키는 버리고 OPENAI_API_KEY 는 null. */
  @Test
  void register_storesNormalizedLoginInfo() throws Exception {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    credentials.register(
        admin,
        agent,
        "chatgpt",
        "  {\"auth_mode\":\"chatgpt\",\"OPENAI_API_KEY\":\"sk-x\",\"junk\":1,"
            + "\"tokens\":{\"refresh_token\":\"r\"}}  ",
        null,
        null);

    String stored =
        encryption.decrypt(
            dsl.select(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN)
                .from(AI_AGENT_CREDENTIAL)
                .where(AI_AGENT_CREDENTIAL.USER_ID.eq(agent))
                .and(AI_AGENT_CREDENTIAL.REVOKED_AT.isNull())
                .fetchOne(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN));
    JsonNode n = om.readTree(stored);
    assertThat(n.has("junk")).isFalse();
    assertThat(n.get("OPENAI_API_KEY").isNull()).isTrue();
    assertThat(n.at("/tokens/refresh_token").asText()).isEqualTo("r");
  }

  /** ai-agent redeem·복호화 경로는 로그인 정보를 Claude 토큰으로 넘기지 않는다(연결 없음). */
  @Test
  void redeem_loginProvider_isNotConnected() {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    registerChatgpt(agent);

    assertThatThrownBy(() -> credentials.redeemSelf(agent))
        .isInstanceOf(OAuthTokenNotFoundException.class);
    assertThatThrownBy(() -> credentials.decryptActivePayload(agent))
        .isInstanceOf(OAuthTokenNotFoundException.class);
    assertThat(credentials.getActiveMeta(agent).lastUsedAt()).isNull();
  }

  // ---- desired·/secrets/login ----

  /** 템플릿 계정과 같은 종류면 login version = 연결 id, /secrets/login 이 다듬은 원문을 캐시 금지로 준다. */
  @Test
  void desiredAndLoginSecret_whenProviderMatches_returnIdAndPayload() throws Exception {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    long credId = registerChatgpt(agent);
    settingService.start(admin, agent);

    JsonNode login = secretNamed(desiredAgent(agent), "login");
    assertThat(login.get("source").asText()).isEqualTo("WORKS");
    assertThat(login.get("version").asLong()).isEqualTo(credId);
    assertThat(login.get("rotateAfter").isNull()).isTrue();
    assertThat(secretNamed(desiredAgent(agent), "claude")).isNull();

    String payload =
        om.readTree(
                runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.version").value(credId))
                    .andExpect(jsonPath("$.provider").value("chatgpt"))
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("payload")
            .asText();
    assertThat(om.readTree(payload).at("/tokens/refresh_token").asText()).isEqualTo("fake-refresh");
  }

  /** 다른 종류의 연결만 남았거나 연결이 없으면 login version null·/secrets/login 은 RUNNER_SECRET_NOT_FOUND. */
  @Test
  void desiredAndLoginSecret_whenProviderMismatchOrMissing_returnNullAndSecretNotFound()
      throws Exception {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    registerChatgpt(agent);
    settingService.start(admin, agent);
    forceCredential(agent, "anthropic", "T".repeat(64));

    assertThat(secretNamed(desiredAgent(agent), "login").get("version").isNull()).isTrue();
    runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_SECRET_NOT_FOUND"));

    TenantContext.set(1L);
    credentialRepo.revokeActive(agent);
    assertThat(secretNamed(desiredAgent(agent), "login").get("version").isNull()).isTrue();
    runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_SECRET_NOT_FOUND"));
  }

  /** 로그인 계정을 쓰지 않는 템플릿(claude-code)은 login 참조가 없고 /secrets/login 도 RUNNER_SECRET_NOT_FOUND. */
  @Test
  void loginSecret_forClaudeTemplate_returnsSecretNotFound() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    registerAnthropic(agent);
    settingService.start(admin, agent);

    assertThat(secretNamed(desiredAgent(agent), "login")).isNull();
    runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_SECRET_NOT_FOUND"));
  }

  /** 이 위치에서 켜져 있지 않으면 RUNNER_AGENT_NOT_FOUND(runner 가 다시 시도한다). */
  @Test
  void loginSecret_whenNotRunningHere_returnsAgentNotFound() throws Exception {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    registerChatgpt(agent);

    runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_AGENT_NOT_FOUND"));
  }

  // ---- 켜기 전 확인 ----

  /** 로그인 계정 템플릿은 그 로그인이 없으면 켜지 않는다(409). */
  @Test
  void start_loginTemplateWithoutLogin_returns409() {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);

    assertThatThrownBy(() -> settingService.start(admin, agent))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("「ChatGPT 로그인」을 먼저 연결해 주세요");
  }

  /** claude-code 는 연결 없이도 지금처럼 켜진다(확인 범위는 로그인 계정만). */
  @Test
  void start_claudeTemplateWithoutCredential_stillStarts() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");

    settingService.start(admin, agent);
  }

  // ---- OpenCode 템플릿(WP-1410) — OpenAI 호환(opencode) 연결도 로그인 정보 경로로 Pod 에 전달된다 ----

  /**
   * opencode 템플릿은 연결 종류(opencode)와 맞고 login 참조를 낸다 — version 은 연결 id 가 아니라 「연결 id + 지정 모델 + 연결
   * 원문」에서 계산한 값이고, /secrets/login 응답의 version 과 같아야 한다(다르면 runner 가 매 회차 다시 받는다). 기본 방식의 연결 종류이므로
   * 모델 조회 등 다른 경로는 그대로다.
   */
  @Test
  void desired_opencodeTemplateWithOpencodeCredential_hasLoginRefMatchingLoginSecret()
      throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);

    JsonNode login = secretNamed(desiredAgent(agent), "login");
    assertThat(login.get("source").asText()).isEqualTo("WORKS");
    assertThat(login.get("version").isIntegralNumber()).isTrue();
    assertThat(login.get("version").asLong()).isEqualTo(loginSecretVersion(agent));
    // runner(TypeScript)의 JSON 숫자로 정확히 옮겨지는 범위(2^53 미만)여야 한다.
    assertThat(login.get("version").asLong()).isBetween(1L, (1L << 53) - 1);
    assertThat(secretNamed(desiredAgent(agent), "claude")).isNull();
  }

  /** /secrets/login 응답의 version. */
  private long loginSecretVersion(long agent) throws Exception {
    return om.readTree(
            runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString())
        .get("version")
        .asLong();
  }

  /** /secrets/login 응답 payload(연결 원문 + defaultModel)를 JSON 으로. */
  private JsonNode loginSecretPayload(long agent) throws Exception {
    return om.readTree(
        om.readTree(
                runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
                    .andExpect(status().isOk())
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("payload")
            .asText());
  }

  private long desiredLoginVersion(long agent) throws Exception {
    return secretNamed(desiredAgent(agent), "login").get("version").asLong();
  }

  /**
   * 비서 설정에서 모델만 바꿔도(assistant_config.model → defaultModel) login version 이 바뀐다 — 그대로면 runner 가
   * login-info 를 다시 받지 않아 Pod 가 옛 모델로 뜬다. 바뀐 version 은 /secrets/login 의 version 과 같고 payload 에 새
   * 모델이 실린다.
   */
  @Test
  void desiredLoginVersion_whenConfiguredModelChanges_changesAndMatchesLoginSecret()
      throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);
    long before = desiredLoginVersion(agent);

    configRepo.upsert(agent, "vllm/llama4", null, null, null);

    long after = desiredLoginVersion(agent);
    assertThat(after).isNotEqualTo(before);
    assertThat(loginSecretVersion(agent)).isEqualTo(after);
    assertThat(loginSecretPayload(agent).get("defaultModel").asText()).isEqualTo("vllm/llama4");
  }

  /**
   * 같은 연결 행에서 이미지 입력 지정만 고쳐도(updateModelVision — 행을 그 자리에서 다시 쓴다) login version 이 바뀌고
   * /secrets/login 과 같다.
   */
  @Test
  void desiredLoginVersion_whenVisionChangesInPlace_changesAndMatchesLoginSecret()
      throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);
    long before = desiredLoginVersion(agent);

    credentials.updateModelVision(agent, "vllm/qwen3", BooleanNode.TRUE);

    long after = desiredLoginVersion(agent);
    assertThat(after).isNotEqualTo(before);
    assertThat(loginSecretVersion(agent)).isEqualTo(after);
    assertThat(loginSecretPayload(agent).at("/vision/vllm~1qwen3").asBoolean()).isTrue();
  }

  /**
   * 같은 값을 다시 저장하면(행은 새 IV 로 다시 암호화된다) login version 은 그대로다 — 원문으로 계산하므로 일하던 Pod 를 까닭 없이 다시 만들지 않는다.
   */
  @Test
  void desiredLoginVersion_whenSameVisionResaved_staysTheSame() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);
    credentials.updateModelVision(agent, "vllm/qwen3", BooleanNode.TRUE);
    long before = desiredLoginVersion(agent);

    credentials.updateModelVision(agent, "vllm/qwen3", BooleanNode.TRUE);

    assertThat(desiredLoginVersion(agent)).isEqualTo(before);
    assertThat(loginSecretVersion(agent)).isEqualTo(before);
  }

  /** 생각의 깊이처럼 Pod 에 넘기지 않는 설정만 바뀌면 login version 은 그대로다(쓸데없이 Pod 를 다시 만들지 않게). */
  @Test
  void desiredLoginVersion_whenOnlyThinkingDepthChanges_staysSame() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);
    long before = desiredLoginVersion(agent);

    configRepo.upsert(agent, "vllm/qwen3", "HIGH", null, null);

    assertThat(desiredLoginVersion(agent)).isEqualTo(before);
  }

  /**
   * 지정 모델이 이 연결의 「providerId/」 접두가 아니면(옛 Claude 기본값 등) defaultModel 은 null 로 나간다 — Pod 가 엉뚱한 모델로 뜨지
   * 않고 「모델을 정할 수 없음」으로 멈추게.
   */
  @Test
  void loginSecret_opencodeModelWithoutProviderPrefix_hasNullDefaultModel() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);

    for (String model : List.of("claude-sonnet-4-5", "other/qwen3", "vllm/")) {
      configRepo.upsert(agent, model, null, null, null);
      JsonNode n = loginSecretPayload(agent);
      assertThat(n.has("defaultModel")).as(model).isTrue();
      assertThat(n.get("defaultModel").isNull()).as(model).isTrue();
    }
  }

  /**
   * opencode 템플릿에 다른 종류(anthropic) 연결만 남았으면 login version 은 null 이다(runner 가 Pod 의 로그인 정보를 지운다).
   */
  @Test
  void desired_opencodeTemplateWithOtherProvider_hasNullLoginVersion() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);
    forceCredential(agent, "anthropic", "T".repeat(64));

    assertThat(secretNamed(desiredAgent(agent), "login").get("version").isNull()).isTrue();
  }

  /** /secrets/login 은 opencode 연결의 원문 JSON 에 연결에 지정한 모델(defaultModel)을 더해 캐시 금지로 준다. */
  @Test
  void loginSecret_opencodeTemplate_returnsOriginalPayloadWithDefaultModel() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);

    String payload =
        om.readTree(
                runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
                    .andExpect(status().isOk())
                    .andExpect(header().string("Cache-Control", "no-store"))
                    .andExpect(jsonPath("$.provider").value("opencode"))
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("payload")
            .asText();
    JsonNode n = om.readTree(payload);
    assertThat(n.get("providerId").asText()).isEqualTo("vllm");
    assertThat(n.get("npm").asText()).isEqualTo("@ai-sdk/openai-compatible");
    assertThat(n.at("/options/baseURL").asText()).isEqualTo("https://api.example.com/v1");
    assertThat(n.at("/options/apiKey").asText()).isEqualTo("sk-fake-opencode");
    assertThat(n.get("defaultModel").asText()).isEqualTo("vllm/qwen3");
  }

  /** 연결을 읽어도 last_used_at 은 갱신하지 않는다(Pod 로 옮겨 담는 것이지 실제 호출이 아니다). */
  @Test
  void loginSecret_opencodeTemplate_doesNotTouchLastUsed() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);

    runner(get(RUNNER + "/agents/" + agent + "/secrets/login")).andExpect(status().isOk());

    assertThat(credentials.getActiveMeta(agent).lastUsedAt()).isNull();
  }

  /** 지정한 모델이 비어 있으면 defaultModel 은 null 이다(엔트리포인트가 분명한 오류로 실패한다). */
  @Test
  void loginSecret_opencodeTemplateWithoutModel_hasNullDefaultModel() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    forceCredential(agent, "opencode", OPENCODE_CONFIG);
    settingService.start(admin, agent);

    String payload =
        om.readTree(
                runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
                    .andExpect(status().isOk())
                    .andReturn()
                    .getResponse()
                    .getContentAsString())
            .get("payload")
            .asText();
    JsonNode n = om.readTree(payload);
    assertThat(n.has("defaultModel")).isTrue();
    assertThat(n.get("defaultModel").isNull()).isTrue();
  }

  /** opencode 템플릿에 다른 종류(anthropic) 연결이면 /secrets/login 은 RUNNER_SECRET_NOT_FOUND 404. */
  @Test
  void loginSecret_opencodeTemplateWithOtherProvider_returnsSecretNotFound() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");
    settingService.start(admin, agent);
    forceCredential(agent, "anthropic", "T".repeat(64));

    runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_SECRET_NOT_FOUND"));
  }

  /** claude-code 템플릿에 opencode 연결이 남았어도(맞지 않는 옛 연결) /secrets/login 은 주지 않는다. */
  @Test
  void loginSecret_claudeTemplateWithOpencodeCredential_returnsSecretNotFound() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    registerAnthropic(agent);
    settingService.start(admin, agent);
    forceCredential(agent, "opencode", OPENCODE_CONFIG);

    runner(get(RUNNER + "/agents/" + agent + "/secrets/login"))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("RUNNER_SECRET_NOT_FOUND"));
  }

  /** opencode 템플릿도 맞는 연결이 없으면 켜지 않는다(409 — 「OpenAI 호환」을 먼저 연결). */
  @Test
  void start_opencodeTemplateWithoutCredential_returns409() {
    long agent = newAgent();
    putTemplate(agent, "opencode");

    assertThatThrownBy(() -> settingService.start(admin, agent))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("「OpenAI 호환」을 먼저 연결해 주세요");
  }

  /**
   * 등록 때 검증하기 전에 저장된 옛 연결의 providerId 가 Pod 가 받는 꼴(영문·숫자·. _ -)이 아니면 켜지 않는다(409) — 켜져도 Pod 가 칸을 띄우지
   * 않는다.
   */
  @Test
  void start_opencodeTemplateWithUnsafeProviderId_returns409() {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    forceCredential(
        agent,
        "opencode",
        "{\"providerId\":\"my provider/x\",\"options\":{\"baseURL\":\"https://api.example.com/v1\","
            + "\"apiKey\":\"sk-fake\"}}");

    assertThatThrownBy(() -> settingService.start(admin, agent))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessageContaining("providerId");
  }

  /** OpenCode 템플릿 AI 의 등록은 providerId 가 Pod 가 받는 꼴이 아니면(공백·슬래시·숫자 값) 400 이다. */
  @Test
  void register_opencodeWithUnsafeProviderId_isRejected() {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    for (String pid : List.of("\"a/b\"", "\"my provider\"", "\"\"", "123")) {
      String payload =
          "{\"providerId\":"
              + pid
              + ",\"options\":{\"baseURL\":\"https://api.example.com/v1\",\"apiKey\":\"sk-fake\"}}";
      assertThatThrownBy(() -> credentials.register(admin, agent, "opencode", payload, "x", "x/m"))
          .as(pid)
          .isInstanceOf(InvalidProviderCredentialException.class)
          .hasMessageContaining("providerId");
    }
  }

  /**
   * 기본(서버) 방식 AI 의 OpenAI 호환 연결은 Pod 로 넘어가지 않으므로 providerId 를 예전처럼 받는다 — 기존 연결의 키를 바꿔 다시 등록해도 400 이
   * 나지 않게. 나중에 OpenCode 템플릿으로 바꾸면 켜기 확인이 409 로 막는다.
   */
  @Test
  void register_opencodeWithUnsafeProviderIdInServerMode_isAcceptedButStartIsBlocked() {
    long agent = newAgent();
    String payload =
        "{\"providerId\":\"my provider\",\"options\":{\"baseURL\":\"https://api.example.com/v1\","
            + "\"apiKey\":\"sk-fake\"}}";

    credentials.register(admin, agent, "opencode", payload, "x", "my provider/m");

    putTemplate(agent, "opencode");
    assertThatThrownBy(() -> settingService.start(admin, agent))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessageContaining("providerId");
  }

  /** 맞는 연결(opencode)이 있으면 opencode 템플릿이 켜진다. */
  @Test
  void start_opencodeTemplateWithOpencodeCredential_starts() {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    registerOpencode(agent, "vllm/qwen3");

    settingService.start(admin, agent);
  }

  /** opencode 템플릿의 model 칸 기본값 auto 는 저장 검증을 통과한다. */
  @Test
  void put_opencodeTemplateWithAutoModel_isAccepted() {
    long agent = newAgent();

    settingService.put(
        admin,
        agent,
        new PutAgentRuntimeSettingRequest("opencode", null, Map.of("model", "auto"), null));
  }

  // ---- 실행 방식 변경 때 끊기 ----

  /** 내 컴퓨터에서 쓰던 chatgpt 연결은 claude-code 로 옮기면 끊긴다. */
  @Test
  void put_claudeTemplate_revokesChatgptCredential() {
    long agent = newAgent();
    userService.setAgentRuntime(admin, agent, AgentRuntime.EXTERNAL);
    registerChatgpt(agent);

    putTemplate(agent, "claude-code");

    assertThat(activeProvider(agent)).isEmpty();
  }

  /** anthropic 연결은 로그인 템플릿으로 바꾸면(기존 행 변경) 끊기고, 맞는 템플릿(claude-code)으로 처음 둘 때는 남는다. */
  @Test
  void put_revokesOnlyNonFittingCredential() {
    long agent = newAgent();
    registerAnthropic(agent);

    putTemplate(agent, "claude-code");
    assertThat(activeProvider(agent)).contains("anthropic");

    putTemplate(agent, LOGIN_TEMPLATE);
    assertThat(activeProvider(agent)).isEmpty();
  }

  /** 맞는 연결은 같은 템플릿으로 다시 저장해도 남는다. */
  @Test
  void put_keepsFittingLoginCredential() {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    registerChatgpt(agent);

    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest(LOGIN_TEMPLATE, null, Map.of(), null));

    assertThat(activeProvider(agent)).contains("chatgpt");
  }

  /** 기본으로 바꾸면 로그인 연결이 끊긴다 — 실행 설정이 있던(꺼진) AI 와 없던 내 컴퓨터 AI 모두. */
  @Test
  void switchToInternal_revokesLoginCredential() {
    long workspace = newAgent();
    putTemplate(workspace, LOGIN_TEMPLATE);
    registerChatgpt(workspace);
    long external = newAgent();
    userService.setAgentRuntime(admin, external, AgentRuntime.EXTERNAL);
    registerChatgpt(external);

    userService.setAgentRuntime(admin, workspace, AgentRuntime.INTERNAL);
    userService.setAgentRuntime(admin, external, AgentRuntime.INTERNAL);

    assertThat(activeProvider(workspace)).isEmpty();
    assertThat(activeProvider(external)).isEmpty();
  }

  /** 기본으로 바꿔도 Claude 연결은 남는다. */
  @Test
  void switchToInternal_keepsAnthropicCredential() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    registerAnthropic(agent);

    userService.setAgentRuntime(admin, agent, AgentRuntime.INTERNAL);

    assertThat(activeProvider(agent)).contains("anthropic");
  }

  /** 켜진 AI 의 기본 전환은 409 로 거절되고, 그때는 연결을 끊지 않는다. */
  @Test
  void switchToInternal_whenRunning_rejectsAndKeepsCredential() {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    registerChatgpt(agent);
    settingService.start(admin, agent);

    assertThatThrownBy(() -> userService.setAgentRuntime(admin, agent, AgentRuntime.INTERNAL))
        .isInstanceOf(AgentRuntimeSettingConflictException.class);

    assertThat(activeProvider(agent)).contains("chatgpt");
  }

  /** 내 컴퓨터로 바꾸는 것은 아무것도 끊지 않는다(작업 공간 → 실행 설정 삭제 = 내 컴퓨터). */
  @Test
  void deleteSetting_toExternal_keepsLoginCredential() {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    registerChatgpt(agent);

    settingService.delete(admin, agent);
    userService.setAgentRuntime(admin, agent, AgentRuntime.EXTERNAL);

    assertThat(activeProvider(agent)).contains("chatgpt");
  }

  // ---- 리뷰 후속 ----

  /** 기본 방식 AI·개인 비서가 loginInfo 없이 genia 를 보내면 「넣어 주세요」가 아니라 실행 방식 문구로 거절된다(맞는 계정 검사가 먼저). */
  @Test
  void register_geniaWithoutLoginInfo_onServerAgent_returnsModeFitMessage() {
    long agent = newAgent();

    assertThatThrownBy(() -> credentials.register(admin, agent, "genia", null, null, null))
        .isInstanceOf(InvalidProviderCredentialException.class)
        .hasMessageContaining("기본 실행 방식")
        .hasMessageNotContaining("로그인 정보를 넣어 주세요");
    assertThatThrownBy(
            () -> personalAssistants.registerCredential(admin, "genia", null, null, null))
        .isInstanceOf(InvalidProviderCredentialException.class)
        .hasMessageContaining("기본 실행 방식")
        .hasMessageNotContaining("로그인 정보를 넣어 주세요");
  }

  /** 바뀐 것이 없는 다시 저장은 맞지 않는 옛 연결이라도 끊지 않는다(조용히 연결이 사라지지 않게). */
  @Test
  void put_unchangedSetting_keepsNonFittingLegacyCredential() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    forceCredential(agent, "chatgpt", chatgptLogin("legacy@example.test"));

    putTemplate(agent, "claude-code");

    assertThat(activeProvider(agent)).contains("chatgpt");
  }

  /** 켜진 claude-code AI 를 로그인 계정 템플릿으로 바꾸면 409 이고, Claude 연결은 그대로 남는다. */
  @Test
  void put_runningAgentToLoginTemplate_returns409AndKeepsCredential() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    registerAnthropic(agent);
    settingService.start(admin, agent);

    assertThatThrownBy(() -> putTemplate(agent, LOGIN_TEMPLATE))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("「ChatGPT 로그인」을 먼저 연결해 주세요");

    assertThat(activeProvider(agent)).contains("anthropic");
  }

  /** 켜진 AI 의 템플릿과 위치를 함께 바꾸는데 새 위치의 자리가 꽉 찼으면 409 이고, 새 템플릿에 맞지 않는 연결도 끊지 않는다(끊기는 모든 거절 검사 뒤). */
  @Test
  void put_runningAgentToFullLocationWithTemplateChange_returns409AndKeepsCredential() {
    long full =
        locationService
            .create(admin, new CreateAgentLocationRequest("L2", null, 1))
            .location()
            .id();
    long occupant = newAgent();
    settingService.put(
        admin, occupant, new PutAgentRuntimeSettingRequest("claude-code", full, Map.of(), null));
    settingService.start(admin, occupant);
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    registerChatgpt(agent);
    settingService.start(admin, agent);

    assertThatThrownBy(
            () ->
                settingService.put(
                    admin,
                    agent,
                    new PutAgentRuntimeSettingRequest("claude-code", full, Map.of(), null)))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("실행 위치의 자리가 모두 찼습니다");

    assertThat(activeProvider(agent)).contains("chatgpt");
  }
}
