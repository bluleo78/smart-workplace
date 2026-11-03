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
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.exception.AgentRuntimeSettingConflictException;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.ProviderCredentialRegisterRequest;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.exception.OAuthTokenNotFoundException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
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
