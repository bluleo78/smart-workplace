package com.workplace.agentaccount;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountResponse;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountBindingService;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.exception.AgentRuntimeSettingConflictException;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.ProviderCredentialRegisterRequest;
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
 * WP-1448 실행 방식 전환·켜기 확인·기존 연결 등록 다리 통합 테스트.
 *
 * <ul>
 *   <li>다른 방식 → 작업 공간(실행 설정 새로 생김): 활성 연결은 맞든 안 맞든 끊긴다(계정을 고르게).
 *   <li>작업 공간 → 다른 방식(설정 삭제·기본 전환): 묶인 계정이 풀리고, 묶여 있었으면 남은 옛 연결도 끊긴다.
 *   <li>템플릿을 바꾸는 저장: 새 템플릿에 맞지 않는 묶인 계정은 풀리고, 맞으면 그대로다.
 *   <li>켜기: 로그인 템플릿 AI 는 맞는 묶인 계정만 있어도 켜지고, 계정도 연결도 없으면 409.
 *   <li>관리 경로 연결 등록·회수(화면 WP-1451 전까지의 다리): Pod AI 면 같은 원문으로 계정을 만들어(같은 키는 하나로) 묶고, 회수하면 푼다. 개인
 *       비서·기본 방식 AI 는 이전과 같다.
 * </ul>
 *
 * <p>모든 키 값은 가짜다. 로그인 템플릿은 테스트 전용 {@code test-chatgpt}.
 */
@Transactional
class AgentAccountRuntimeSwitchTest extends IntegrationTestBase {

  private static final String RUNNER = "/api/v1/agent-runtime/runner";
  private static final String LOGIN_TEMPLATE = "test-chatgpt";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AiAgentCredentialService credentials;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountBindingService bindingService;
  @Autowired AgentAccountBindingRepository bindings;
  @Autowired AgentAccountRepository accounts;
  @Autowired EncryptionService encryption;
  @Autowired AiAgentCredentialRepository credentialRepo;
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

  // ---- 준비 도우미 ----

  /**
   * 가짜 Codex auth.json — account_id + 로그인한 사람(이메일, 늘 c@example.test)이 계정 정체성(지문)이고 refresh 로 원문을
   * 가른다.
   */
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

  private long newAgent() {
    useTenant(1L);
    return TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
  }

  private void putTemplate(long agent, String template) {
    useTenant(1L);
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
  }

  private long anthropicAccount(char c) {
    return accountService
        .register(admin, new AgentAccountRequest("anthropic", claudeToken(c), null, null, null))
        .id();
  }

  private long chatgptAccount(String accountId, String refresh) {
    return accountService
        .register(
            admin,
            new AgentAccountRequest("chatgpt", null, null, null, chatgptLogin(accountId, refresh)))
        .id();
  }

  private Optional<String> activeProvider(long agent) {
    useTenant(1L);
    return credentials.findActiveProvider(agent);
  }

  private Optional<Long> boundAccount(long agent) {
    useTenant(1L);
    return bindings.findAccountId(agent);
  }

  /** 웹 로그인 세션 인증(user:write) 으로 관리 API 를 부른다 — 요청 필터가 테넌트를 비우므로 앞뒤로 다시 맞춘다. */
  private ResultActions admin(MockHttpServletRequestBuilder b) throws Exception {
    useTenant(1L);
    ResultActions r =
        mvc.perform(
            b.with(
                authentication(
                    WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write"))))));
    useTenant(1L);
    return r;
  }

  private static String credentialUrl(long agent) {
    return "/api/v1/admin/agents/" + agent + "/provider-credential";
  }

  /** 관리 경로로 연결을 등록한다(201 기대). */
  private void adminRegister(long agent, ProviderCredentialRegisterRequest req) throws Exception {
    admin(
            post(credentialUrl(agent))
                .contentType(MediaType.APPLICATION_JSON)
                .content(om.writeValueAsString(req)))
        .andExpect(status().isCreated());
  }

  private static ProviderCredentialRegisterRequest anthropicRequest(char c, String label) {
    return new ProviderCredentialRegisterRequest(
        "anthropic", claudeToken(c), null, null, label, null);
  }

  private JsonNode runnerSecret(long agent, String kind) throws Exception {
    useTenant(1L);
    String body =
        mvc.perform(
                get(RUNNER + "/agents/" + agent + "/secrets/" + kind)
                    .header("Authorization", "Bearer " + runnerToken))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    useTenant(1L);
    return om.readTree(body);
  }

  private List<AgentAccountResponse> accountList() {
    useTenant(1L);
    return accountService.list();
  }

  // ---- 실행 방식 전환 ----

  /** 내 컴퓨터 AI 의 맞는 Claude 연결도 작업 공간으로 옮기면 끊긴다 — 계정을 고르게 한다(자동 변환 없음). */
  @Test
  void switchToWorkspaceRevokesLegacyCredential() {
    long agent = newAgent();
    userService.setAgentRuntime(admin, agent, AgentRuntime.EXTERNAL);
    credentials.register(admin, agent, "anthropic", claudeToken('E'), "mine", null);

    putTemplate(agent, "claude-code");

    assertThat(activeProvider(agent)).isEmpty();
    assertThat(boundAccount(agent)).isEmpty();
    assertThat(accountList()).isEmpty();
  }

  /** 실행 설정을 지우면 묶인 계정이 풀리고, 남은 옛 연결도 끊긴다(새 방식의 연결을 요구). */
  @Test
  void deleteSettingUnbindsAccountAndRevokesLegacy() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    credentials.register(admin, agent, "anthropic", claudeToken('L'), "legacy", null);
    bindingService.bind(admin, agent, anthropicAccount('A'));

    settingService.delete(admin, agent);

    assertThat(boundAccount(agent)).isEmpty();
    assertThat(activeProvider(agent)).isEmpty();
  }

  /** 묶이지 않은 AI 의 설정 삭제는 지금처럼 연결을 끊지 않는다(내 컴퓨터로 갈 수 있으므로). */
  @Test
  void deleteSettingWithoutAccountKeepsLegacy() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    credentials.register(admin, agent, "anthropic", claudeToken('L'), "legacy", null);

    settingService.delete(admin, agent);

    assertThat(activeProvider(agent)).contains("anthropic");
  }

  /** 기본 방식으로 바꾸면 묶인 계정이 풀리고, 묶여 있었으면 맞는 옛 연결(Claude)도 끊긴다. */
  @Test
  void internalSwitchUnbindsAccount() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    credentials.register(admin, agent, "anthropic", claudeToken('L'), "legacy", null);
    bindingService.bind(admin, agent, anthropicAccount('A'));

    userService.setAgentRuntime(admin, agent, AgentRuntime.INTERNAL);

    assertThat(boundAccount(agent)).isEmpty();
    assertThat(activeProvider(agent)).isEmpty();
  }

  /** 템플릿을 바꾸는 저장 — 새 템플릿에 맞지 않는 묶인 계정은 풀리고, 맞는 계정은 그대로다. */
  @Test
  void templateChangeUnbindsUnfitAccount() {
    long claude = newAgent();
    putTemplate(claude, "claude-code");
    bindingService.bind(admin, claude, anthropicAccount('A'));

    putTemplate(claude, LOGIN_TEMPLATE);

    assertThat(boundAccount(claude)).isEmpty();

    long codex = newAgent();
    putTemplate(codex, "codex");
    long login = chatgptAccount("acc-keep", "refresh-keep");
    bindingService.bind(admin, codex, login);

    putTemplate(codex, LOGIN_TEMPLATE);

    assertThat(boundAccount(codex)).contains(login);
  }

  // ---- 켜기 확인 ----

  /** 로그인 템플릿 AI 는 활성 연결 없이 맞는 묶인 계정만 있어도 켜진다. */
  @Test
  void startWithBoundLoginAccountPasses() {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    bindingService.bind(admin, agent, chatgptAccount("acc-start", "refresh-start"));

    settingService.start(admin, agent);

    assertThat(activeProvider(agent)).isEmpty();
  }

  /** 계정도 연결도 없는 로그인 템플릿 AI 의 켜기는 409. */
  @Test
  void startWithoutAccountConflicts() {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);

    assertThatThrownBy(() -> settingService.start(admin, agent))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("「ChatGPT 로그인」을 먼저 연결해 주세요");
  }

  /**
   * 묶인 계정이 템플릿에 맞지 않으면 맞는 옛 연결이 있어도 켜기는 409 — runner 는 묶인 계정이 맞지 않을 때 옛 연결로 내려가지 않으므로 켜기 확인도 묶인 계정만
   * 본다. 이 상태는 템플릿 정의가 계정 종류를 바꿀 때 생기므로 설정 행의 템플릿 이름을 직접 바꿔 만든다.
   */
  @Test
  void startWithUnfitBoundAccountConflictsEvenIfLegacyFits() {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    bindingService.bind(admin, agent, anthropicAccount('U'));
    useTenant(1L);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, LOGIN_TEMPLATE)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
    credentialRepo.insert(
        agent,
        "chatgpt",
        encryption.encrypt(chatgptLogin("acc-legacy", "refresh-legacy")),
        "legacy",
        admin);
    assertThat(activeProvider(agent)).contains("chatgpt");

    assertThatThrownBy(() -> settingService.start(admin, agent))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessage("「ChatGPT 로그인」을 먼저 연결해 주세요");
  }

  /** 묶인 OpenAI 호환 계정의 providerId 가 Pod 가 받는 꼴이 아니면(검증 전 이관된 원문 등) 켜기가 409 로 이유를 알린다. */
  @Test
  void startWithBoundUnsafeOpencodeAccountConflicts() {
    long agent = newAgent();
    putTemplate(agent, "opencode");
    String unsafe =
        "{\"providerId\":\"my provider\",\"options\":{\"baseURL\":\"https://api.example.com/v1\","
            + "\"apiKey\":\"sk-fake\"}}";
    useTenant(1L);
    long accountId =
        accounts.insert(
            "opencode",
            "옛 OpenAI 호환",
            encryption.encrypt(unsafe),
            null,
            null,
            AgentAccountService.STATUS_ACTIVE,
            AgentAccountService.fingerprint("opencode", unsafe),
            admin);
    bindingService.bind(admin, agent, accountId);

    assertThatThrownBy(() -> settingService.start(admin, agent))
        .isInstanceOf(AgentRuntimeSettingConflictException.class)
        .hasMessageContaining("providerId");
  }

  // ---- 기존 연결 등록 다리 ----

  /** Pod AI 에 관리 경로로 로그인 정보를 등록하면 연결 행과 함께 같은 원문의 계정이 생겨 묶이고, runner 는 그 원문을 받는다. */
  @Test
  void legacyRegisterOnPodAgentCreatesAndBindsAccount() throws Exception {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);

    adminRegister(
        agent,
        new ProviderCredentialRegisterRequest(
            "chatgpt", null, null, null, null, chatgptLogin("acc-bridge", "refresh-bridge")));

    assertThat(activeProvider(agent)).contains("chatgpt");
    Optional<Long> bound = boundAccount(agent);
    assertThat(bound).isPresent();
    AgentAccountResponse account = accountService.get(bound.get());
    assertThat(account.provider()).isEqualTo("chatgpt");
    assertThat(account.label()).endsWith(" 계정");

    // 켜진 AI 만 runner 가 비밀값을 받는다 — 묶인 계정의 원문이 나간다.
    settingService.start(admin, agent);
    JsonNode login = runnerSecret(agent, "login");
    assertThat(login.get("version").asLong()).isGreaterThanOrEqualTo(1_000_000_000_000L);
    assertThat(om.readTree(login.get("payload").asText()).at("/tokens/refresh_token").asText())
        .isEqualTo("refresh-bridge");
  }

  /** 두 Pod AI 가 같은 원문을 등록하면 계정은 하나이고 둘이 함께 가리킨다. 요청 라벨이 있으면 그 라벨을 쓴다. */
  @Test
  void legacyRegisterSameKeyReusesAccount() throws Exception {
    long a = newAgent();
    long b = newAgent();
    putTemplate(a, "claude-code");
    putTemplate(b, "claude-code");

    adminRegister(a, anthropicRequest('S', "공용 키"));
    adminRegister(b, anthropicRequest('S', "다른 라벨"));

    List<AgentAccountResponse> all = accountList();
    assertThat(all).hasSize(1);
    assertThat(all.getFirst().label()).isEqualTo("공용 키");
    assertThat(all.getFirst().agents()).hasSize(2);
    assertThat(boundAccount(a)).contains(all.getFirst().id());
    assertThat(boundAccount(b)).contains(all.getFirst().id());
    settingService.start(admin, b);
    assertThat(runnerSecret(b, "claude").get("payload").asText()).isEqualTo(claudeToken('S'));
  }

  /** 같은 ChatGPT 계정을 다시 로그인해 등록하면 계정은 그대로 하나이고 원문만 방금 넣은 것으로 바뀐다(옛 갱신 토큰을 Pod 에 주지 않게). */
  @Test
  void legacyRegisterSameLoginReplacesStaleSecret() throws Exception {
    long agent = newAgent();
    putTemplate(agent, LOGIN_TEMPLATE);
    adminRegister(
        agent,
        new ProviderCredentialRegisterRequest(
            "chatgpt", null, null, null, null, chatgptLogin("acc-same", "refresh-old")));
    long first = boundAccount(agent).orElseThrow();
    useTenant(1L);
    long oldVersion = accounts.findActive(first).orElseThrow().secretVersion();

    adminRegister(
        agent,
        new ProviderCredentialRegisterRequest(
            "chatgpt", null, null, null, null, chatgptLogin("acc-same", "refresh-new")));

    assertThat(accountList()).hasSize(1);
    assertThat(boundAccount(agent)).contains(first);
    useTenant(1L);
    assertThat(accounts.findActive(first).orElseThrow().secretVersion()).isNotEqualTo(oldVersion);
    settingService.start(admin, agent);
    JsonNode login = runnerSecret(agent, "login");
    assertThat(om.readTree(login.get("payload").asText()).at("/tokens/refresh_token").asText())
        .isEqualTo("refresh-new");
  }

  /**
   * 연결 등록이 받아들인 OpenAI 호환 연결은 다리에서도 400 이 나지 않는다 — 계정을 요구하지 않는(서버가 쓰는 Claude·OpenAI 호환을 받는) 작업 공간
   * 템플릿에서는 연결이 Pod 로 넘어가지 않아(deliversToPod=false) 연결 등록이 providerId 를 Pod 꼴로 좁히지 않는다. 다리도 같은 값으로
   * 검사해 등록이 성공하고 계정이 생겨 묶인다(계정 API 는 여전히 엄격하다 — {@code
   * AdminAgentAccountApiTest#registerOpencodeRejectsPodUnsafeProviderId}).
   */
  @Test
  void legacyRegisterOpencodeWithUnsafeProviderIdOnClaudeTemplateStillSucceeds() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "test-no-account");
    var unsafe =
        new ProviderConfig(
            "my provider",
            null,
            Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-fake"));

    adminRegister(
        agent,
        new ProviderCredentialRegisterRequest("opencode", null, unsafe, "gpt-test", null, null));

    assertThat(activeProvider(agent)).contains("opencode");
    Optional<Long> bound = boundAccount(agent);
    assertThat(bound).isPresent();
    assertThat(accountService.get(bound.get()).provider()).isEqualTo("opencode");
  }

  /**
   * 실행 템플릿이 사라진 Pod AI 에도 관리 경로 연결 등록은 성공한다 — 다리는 묶지 못하면 등록을 깨지 않고, 있던 묶음을 풀어 runner 가 방금 쓴 연결로
   * 돌아가게 한다(새 계정도 만들지 않는다).
   */
  @Test
  void legacyRegisterWithMissingTemplateSucceedsAndUnbinds() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    adminRegister(agent, anthropicRequest('M', null));
    long first = boundAccount(agent).orElseThrow();
    useTenant(1L);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, "gone-template")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();

    adminRegister(agent, anthropicRequest('N', null));

    assertThat(boundAccount(agent)).isEmpty();
    assertThat(activeProvider(agent)).contains("anthropic");
    List<AgentAccountResponse> all = accountList();
    assertThat(all).extracting(AgentAccountResponse::id).containsExactly(first);
    useTenant(1L);
    assertThat(encryption.decrypt(credentialRepo.findActive(agent).orElseThrow().encryptedToken()))
        .isEqualTo(claudeToken('N'));
  }

  /** Pod AI 의 연결을 관리 경로로 회수하면 묶음도 풀린다. */
  @Test
  void legacyRevokeOnPodAgentUnbinds() throws Exception {
    long agent = newAgent();
    putTemplate(agent, "claude-code");
    adminRegister(agent, anthropicRequest('R', null));
    assertThat(boundAccount(agent)).isPresent();

    admin(delete(credentialUrl(agent))).andExpect(status().isNoContent());

    assertThat(boundAccount(agent)).isEmpty();
    assertThat(activeProvider(agent)).isEmpty();
  }

  /** 개인 비서·기본(INTERNAL) 방식 AI 의 연결 등록·조회·회수는 이전과 같다 — 계정이 생기지도, 묶이지도 않는다. */
  @Test
  void personalAssistantAndInternalAgentCredentialsUntouched() throws Exception {
    long internal = newAgent();
    adminRegister(internal, anthropicRequest('I', "server"));
    admin(get(credentialUrl(internal))).andExpect(status().isOk());
    assertThat(activeProvider(internal)).contains("anthropic");
    assertThat(boundAccount(internal)).isEmpty();

    useTenant(1L);
    personalAssistants.registerCredential(admin, "anthropic", claudeToken('P'), "mine", null);
    assertThat(accountList()).isEmpty();

    admin(delete(credentialUrl(internal))).andExpect(status().isNoContent());
    assertThat(activeProvider(internal)).isEmpty();
  }
}
