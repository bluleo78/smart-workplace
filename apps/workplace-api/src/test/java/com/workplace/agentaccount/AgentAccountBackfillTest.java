package com.workplace.agentaccount;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountResponse;
import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountBackfill;
import com.workplace.agentaccount.service.AgentAccountBindingService;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.AssistantConfigRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AdminProviderCredentialService;
import com.workplace.auth.service.PersonalAssistantService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1448 기존 연결 이관 백필 통합 테스트 — 작업 공간(Pod) AI 의 활성 연결을 계정으로 옮기고 같은 키는 하나로 합친다.
 *
 * <ul>
 *   <li>대상은 실행 설정 행이 있고, 묶이지 않았고, 개인 비서가 아니고, 활성 연결이 있는 AI 뿐이다.
 *   <li>같은 setup-token·같은 ChatGPT 로그인(account_id·사람) 은 계정 하나로 — 로그인형은 last_refresh 가 가장 최근인 원문을 살리고
 *       「확인 필요」로 둔다.
 *   <li>연결 행은 고치지 않는다(롤링 배포 중 옛 버전이 읽는다). 두 번 돌려도 계정이 늘지 않는다.
 * </ul>
 *
 * <p>Pod AI 의 옛 연결은 실행 설정을 만든 뒤 저장소로 직접 넣는다 — 실행 설정을 새로 만들면 활성 연결이 끊기므로(Task 4) 이관 전 상태(설정과 연결이 함께
 * 있음)를 그렇게 만든다. 모든 키 값은 가짜다.
 */
@Transactional
class AgentAccountBackfillTest extends IntegrationTestBase {

  private static final long TENANT = 1L;
  private static final String LOGIN_TEMPLATE = "test-chatgpt";
  private static final String RUNNER = "/api/v1/agent-runtime/runner";

  /** 가짜 OpenAI 호환 설정 — 연결 등록이 저장하는 꼴(Pod 가 받는 providerId). */
  private static final String OPENCODE_CONFIG =
      "{\"providerId\":\"vllm\",\"options\":{\"baseURL\":\"https://api.example.com/v1\","
          + "\"apiKey\":\"sk-fake\"}}";

  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentAccountBackfill backfill;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentRuntimeSettingRepository settingRepo;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentAccountBindingRepository bindings;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired AdminProviderCredentialService adminCredentials;
  @Autowired PersonalAssistantService personalAssistants;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired EncryptionService encryption;
  @Autowired UserRepository userRepository;
  @Autowired AgentAccountBindingService bindingService;
  @Autowired AssistantConfigRepository configRepo;
  @Autowired MockMvc mvc;

  private long admin;
  private String runnerToken;

  @BeforeEach
  void seed() {
    TenantContext.set(TENANT);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    runnerToken =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .plaintextToken();
  }

  // ---- 준비 도우미 ----

  /**
   * 가짜 Codex auth.json — account_id + 로그인한 사람(이메일, 늘 c@example.test)이 정체성(지문), refresh 로 원문을 가르고
   * lastRefresh 가 있으면 last_refresh 로 싣는다.
   */
  private static String chatgptLogin(String accountId, String refresh, String lastRefresh) {
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
        + "\"}"
        + (lastRefresh == null ? "" : ",\"last_refresh\":\"" + lastRefresh + "\"")
        + "}";
  }

  private static String claudeToken(char c) {
    return "sk-ant-oat01-" + String.valueOf(c).repeat(40);
  }

  private long newAgent() {
    useTenant(TENANT);
    return TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
  }

  /** 작업 공간(Pod) AI 를 만들고 이관 전 상태처럼 옛 연결을 함께 둔다. */
  private long podAgentWithLegacy(String template, String provider, String plaintext) {
    long agent = newAgent();
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
    useTenant(TENANT);
    credentialRepo.insert(agent, provider, encryption.encrypt(plaintext), "legacy", admin);
    return agent;
  }

  private int runBackfill() {
    useTenant(TENANT);
    int n = backfill.backfillTenant(TENANT);
    useTenant(TENANT);
    return n;
  }

  private Optional<Long> boundAccount(long agent) {
    useTenant(TENANT);
    return bindings.findAccountId(agent);
  }

  private AgentAccountRow accountRow(long id) {
    useTenant(TENANT);
    return accounts.findActive(id).orElseThrow();
  }

  private List<AgentAccountResponse> accountList() {
    useTenant(TENANT);
    return accountService.list();
  }

  private String refreshTokenOf(AgentAccountRow row) throws Exception {
    return om.readTree(encryption.decrypt(row.encryptedSecret()))
        .at("/tokens/refresh_token")
        .asText();
  }

  // ---- 이관 ----

  /** Pod AI 의 Claude 연결 → 「<AI 이름> 계정」 이 생겨 묶이고, 원문은 연결과 같고 상태는 정상이다. */
  @Test
  void backfillCreatesAccountForPodAgent() {
    long agent = podAgentWithLegacy("claude-code", "anthropic", claudeToken('A'));

    assertThat(runBackfill()).isEqualTo(1);

    long accountId = boundAccount(agent).orElseThrow();
    AgentAccountRow row = accountRow(accountId);
    String name = userRepository.findById(agent).orElseThrow().name();
    assertThat(row.provider()).isEqualTo("anthropic");
    assertThat(row.label()).isEqualTo(name + " 계정");
    assertThat(row.status()).isEqualTo(AgentAccountService.STATUS_ACTIVE);
    assertThat(encryption.decrypt(row.encryptedSecret())).isEqualTo(claudeToken('A'));
  }

  /**
   * WP-1496: 옛 연결에 저장된 Anthropic 워크스페이스 ID 를 계정이 이어받는다 — 사용자 API 키(sk-ant-usr)여도 건너뛰지 않는다(워크스페이스 ID
   * 는 선택).
   */
  @Test
  void backfillCarriesWorkspaceIdOfLegacyConnection() {
    String usr = "sk-ant-usr01-" + "W".repeat(40);
    long withWs = newAgent();
    settingService.put(
        admin, withWs, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    useTenant(TENANT);
    credentialRepo.insert(
        withWs, "anthropic", encryption.encrypt(usr), "legacy", admin, "wrkspc_legacy");
    long withoutWs = podAgentWithLegacy("claude-code", "anthropic", claudeToken('N'));

    assertThat(runBackfill()).isEqualTo(2);

    assertThat(accountRow(boundAccount(withWs).orElseThrow()).workspaceId())
        .isEqualTo("wrkspc_legacy");
    assertThat(accountRow(boundAccount(withoutWs).orElseThrow()).workspaceId()).isNull();
  }

  /** 같은 setup-token 을 쓰던 Pod AI 둘 → 계정 하나를 함께 가리킨다. */
  @Test
  void backfillMergesSameSetupToken() {
    long a = podAgentWithLegacy("claude-code", "anthropic", claudeToken('S'));
    long b = podAgentWithLegacy("claude-code", "anthropic", claudeToken('S'));

    assertThat(runBackfill()).isEqualTo(2);

    List<AgentAccountResponse> all = accountList();
    assertThat(all).hasSize(1);
    assertThat(all.getFirst().agents()).hasSize(2);
    assertThat(boundAccount(a)).contains(all.getFirst().id());
    assertThat(boundAccount(b)).contains(all.getFirst().id());
  }

  /**
   * 같은 ChatGPT account_id·같은 사람(이메일)의 auth.json 셋(last_refresh 가 옛것·최신·없음) → 계정 하나, 원문은
   * last_refresh 가 가장 최근인 것(없는 것은 가장 옛것으로 본다), 상태는 「확인 필요」. 최신 원문이 가운데 AI 의 것이라 「먼저 만난 원문」으로 만들면
   * 실패한다.
   */
  @Test
  void backfillMergesSameChatgptAccountIdKeepsLatestRefresh() throws Exception {
    long a =
        podAgentWithLegacy(
            LOGIN_TEMPLATE,
            "chatgpt",
            chatgptLogin("acc-merge", "refresh-old", "2026-10-01T00:00:00Z"));
    long b =
        podAgentWithLegacy(
            LOGIN_TEMPLATE,
            "chatgpt",
            chatgptLogin("acc-merge", "refresh-latest", "2026-11-08T09:30:00.123456Z"));
    long c =
        podAgentWithLegacy(
            LOGIN_TEMPLATE, "chatgpt", chatgptLogin("acc-merge", "refresh-none", null));

    assertThat(runBackfill()).isEqualTo(3);

    List<AgentAccountResponse> all = accountList();
    assertThat(all).hasSize(1);
    long accountId = all.getFirst().id();
    assertThat(boundAccount(a)).contains(accountId);
    assertThat(boundAccount(b)).contains(accountId);
    assertThat(boundAccount(c)).contains(accountId);
    AgentAccountRow row = accountRow(accountId);
    assertThat(row.status()).isEqualTo(AgentAccountService.STATUS_NEEDS_CHECK);
    assertThat(refreshTokenOf(row)).isEqualTo("refresh-latest");
  }

  /** 개인 비서(실행 설정 행이 있어도)·Pod 가 아닌 AI 는 건드리지 않는다 — 연결 행·묶음 그대로, 계정도 생기지 않는다. */
  @Test
  void backfillSkipsPersonalAssistantAndNonPodAgents() {
    long internal = newAgent();
    useTenant(TENANT);
    long internalCred =
        credentialRepo.insert(
            internal, "anthropic", encryption.encrypt(claudeToken('I')), "server", admin);

    useTenant(TENANT);
    personalAssistants.registerCredential(admin, "anthropic", claudeToken('P'), "mine", null);
    useTenant(TENANT);
    long assistant = personalRepo.findAgentId(admin).orElseThrow();
    settingRepo.insert(assistant, "claude-code", "1", null, Map.of(), admin);
    long assistantCred = credentialRepo.findActive(assistant).orElseThrow().id();

    assertThat(runBackfill()).isZero();

    assertThat(accountList()).isEmpty();
    assertThat(boundAccount(internal)).isEmpty();
    assertThat(boundAccount(assistant)).isEmpty();
    assertThat(credentialRepo.findActive(internal).orElseThrow().id()).isEqualTo(internalCred);
    assertThat(credentialRepo.findActive(assistant).orElseThrow().id()).isEqualTo(assistantCred);
  }

  /** 이관해도 옛 연결 행은 그대로 활성이다(같은 행, revoked_at null) — 롤링 배포 중 옛 버전이 계속 읽는다. */
  @Test
  void backfillLeavesLegacyCredentialRows() {
    long agent = podAgentWithLegacy("claude-code", "anthropic", claudeToken('L'));
    useTenant(TENANT);
    AiAgentCredentialRow before = credentialRepo.findActive(agent).orElseThrow();

    runBackfill();

    assertThat(boundAccount(agent)).isPresent();
    AiAgentCredentialRow after = credentialRepo.findActive(agent).orElseThrow();
    assertThat(after.id()).isEqualTo(before.id());
    assertThat(after.revokedAt()).isNull();
    assertThat(after.encryptedToken()).isEqualTo(before.encryptedToken());
  }

  /** 두 번 돌려도(재기동) 계정·묶음이 늘거나 바뀌지 않는다. */
  @Test
  void backfillIsIdempotent() {
    long a = podAgentWithLegacy("claude-code", "anthropic", claudeToken('D'));
    long b =
        podAgentWithLegacy(
            LOGIN_TEMPLATE,
            "chatgpt",
            chatgptLogin("acc-idem", "refresh-1", "2026-11-01T00:00:00Z"));
    assertThat(runBackfill()).isEqualTo(2);
    long accountA = boundAccount(a).orElseThrow();
    long accountB = boundAccount(b).orElseThrow();
    long versionB = accountRow(accountB).secretVersion();

    assertThat(runBackfill()).isZero();

    assertThat(accountList()).hasSize(2);
    assertThat(boundAccount(a)).contains(accountA);
    assertThat(boundAccount(b)).contains(accountB);
    assertThat(accountRow(accountB).secretVersion()).isEqualTo(versionB);
  }

  /** 원문을 읽지 못하는 AI·템플릿에 맞지 않는 AI 는 그 AI 만 건너뛰고(연결 그대로) 나머지는 이관한다. */
  @Test
  void backfillSkipsUnreadableAndUnfitAgentsOnly() {
    long unreadable = newAgent();
    settingService.put(
        admin, unreadable, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    useTenant(TENANT);
    credentialRepo.insert(unreadable, "anthropic", "not-a-ciphertext", "broken", admin);
    long unfit = podAgentWithLegacy(LOGIN_TEMPLATE, "anthropic", claudeToken('U'));
    long ok = podAgentWithLegacy("claude-code", "anthropic", claudeToken('K'));

    assertThat(runBackfill()).isEqualTo(1);

    assertThat(boundAccount(unreadable)).isEmpty();
    assertThat(boundAccount(unfit)).isEmpty();
    assertThat(boundAccount(ok)).isPresent();
    assertThat(accountList()).hasSize(1);
    assertThat(credentialRepo.findActive(unreadable)).isPresent();
    assertThat(credentialRepo.findActive(unfit)).isPresent();
  }

  /** 이미 있는 같은 계정의 원문이 더 최근이면 백필은 그 계정에 묶기만 하고 원문·상태를 바꾸지 않는다(옛 보관본으로 덮지 않게). */
  @Test
  void backfillDoesNotOverwriteNewerExistingAccount() throws Exception {
    long agent =
        podAgentWithLegacy(
            LOGIN_TEMPLATE,
            "chatgpt",
            chatgptLogin("acc-existing", "refresh-stale", "2026-10-01T00:00:00Z"));
    useTenant(TENANT);
    long existing =
        accountService
            .register(
                admin,
                new com.workplace.agentaccount.dto.AgentAccountRequest(
                    "chatgpt",
                    null,
                    null,
                    null,
                    chatgptLogin("acc-existing", "refresh-fresh", "2026-11-09T00:00:00Z"),
                    null))
            .id();

    assertThat(runBackfill()).isEqualTo(1);

    assertThat(boundAccount(agent)).contains(existing);
    AgentAccountRow row = accountRow(existing);
    assertThat(refreshTokenOf(row)).isEqualTo("refresh-fresh");
    assertThat(row.status()).isEqualTo(AgentAccountService.STATUS_ACTIVE);
  }

  /** 기동 진입점(모든 활성 테넌트 순회)은 옮길 것이 없어도 예외 없이 끝난다. */
  @Test
  void startupEntryRunsWithoutError() {
    backfill.backfillAllTenants();
    useTenant(TENANT);
  }

  // ---- 기존 연결 등록 다리의 상태(Task 4 리뷰 이월) ----

  /**
   * 백필이 「확인 필요」로 만든 로그인형 계정과 같은 원문을 관리자가 새로 등록하면(다리) 계정은 「정상」이 된다 — 방금 사람이 넣은 값이기 때문. 원문이 같으니 버전은
   * 그대로다.
   */
  @Test
  void bridgeRegisterReactivatesNeedsCheckAccountWithSameSecret() {
    String login = chatgptLogin("acc-bridge", "refresh-same", "2026-11-01T00:00:00Z");
    long first = podAgentWithLegacy(LOGIN_TEMPLATE, "chatgpt", login);
    runBackfill();
    long accountId = boundAccount(first).orElseThrow();
    AgentAccountRow before = accountRow(accountId);
    assertThat(before.status()).isEqualTo(AgentAccountService.STATUS_NEEDS_CHECK);

    long second = newAgent();
    settingService.put(
        admin, second, new PutAgentRuntimeSettingRequest(LOGIN_TEMPLATE, null, Map.of(), null));
    useTenant(TENANT);
    adminCredentials.register(admin, second, "chatgpt", login, null, null, null);

    assertThat(boundAccount(second)).contains(accountId);
    AgentAccountRow after = accountRow(accountId);
    assertThat(after.status()).isEqualTo(AgentAccountService.STATUS_ACTIVE);
    assertThat(after.secretVersion()).isEqualTo(before.secretVersion());
  }

  // ---- runner 버전 이어받기(일하던 Pod 를 다시 만들지 않는다) ----

  /** 원하는 상태를 RUN 으로 바로 바꾼다 — runner 계약만 보려고 행을 직접 고친다. */
  private void run(long agent) {
    useTenant(TENANT);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.DESIRED, "RUN")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agent))
        .execute();
  }

  private JsonNode runnerGet(String path) throws Exception {
    useTenant(TENANT);
    String body =
        mvc.perform(get(RUNNER + path).header("Authorization", "Bearer " + runnerToken))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    useTenant(TENANT);
    return om.readTree(body);
  }

  /** desired 에서 그 AI 의 claude·login 참조 버전(이름 → 버전, 참조가 있는 것만). */
  private Map<String, Long> desiredVersions(long agent) throws Exception {
    for (JsonNode a : runnerGet("/desired").get("agents")) {
      if (a.get("agentUserId").asLong() != agent) continue;
      Map<String, Long> out = new HashMap<>();
      for (JsonNode ref : a.get("secrets")) {
        String name = ref.get("name").asText();
        if (name.equals("claude") || name.equals("login")) {
          out.put(name, ref.get("version").isNull() ? null : ref.get("version").asLong());
        }
      }
      return out;
    }
    throw new AssertionError("desired 에 AI 없음");
  }

  private long secretVersionOf(long agent, String kind) throws Exception {
    return runnerGet("/agents/" + agent + "/secrets/" + kind).get("version").asLong();
  }

  /**
   * Claude·ChatGPT·OpenAI 호환 Pod AI — 이관 전후로 desired 의 claude/login 버전과 /secrets 응답 버전이 똑같다(runner
   * 가 Pod 를 갈지 않는다).
   */
  @Test
  void backfillKeepsRunnerVersionsUnchanged() throws Exception {
    long claude = podAgentWithLegacy("claude-code", "anthropic", claudeToken('V'));
    long codex =
        podAgentWithLegacy(
            LOGIN_TEMPLATE,
            "chatgpt",
            chatgptLogin("acc-ver", "refresh-ver", "2026-11-01T00:00:00Z"));
    long open = podAgentWithLegacy("opencode", "opencode", OPENCODE_CONFIG);
    useTenant(TENANT);
    configRepo.upsert(open, "vllm/qwen3", null, null, null);
    run(claude);
    run(codex);
    run(open);
    Map<String, Long> claudeBefore = desiredVersions(claude);
    Map<String, Long> codexBefore = desiredVersions(codex);
    Map<String, Long> openBefore = desiredVersions(open);
    long claudeSecretBefore = secretVersionOf(claude, "claude");
    long codexSecretBefore = secretVersionOf(codex, "login");
    long openSecretBefore = secretVersionOf(open, "login");
    assertThat(claudeBefore.get("claude")).isNotNull();
    assertThat(codexBefore.get("login")).isNotNull();
    assertThat(openBefore.get("login")).isNotNull();

    assertThat(runBackfill()).isEqualTo(3);

    assertThat(boundAccount(claude)).isPresent();
    assertThat(boundAccount(codex)).isPresent();
    assertThat(boundAccount(open)).isPresent();
    assertThat(desiredVersions(claude)).isEqualTo(claudeBefore);
    assertThat(desiredVersions(codex)).isEqualTo(codexBefore);
    assertThat(desiredVersions(open)).isEqualTo(openBefore);
    assertThat(secretVersionOf(claude, "claude")).isEqualTo(claudeSecretBefore);
    assertThat(secretVersionOf(codex, "login")).isEqualTo(codexSecretBefore);
    assertThat(secretVersionOf(open, "login")).isEqualTo(openSecretBefore);
  }

  /** 이관 뒤 계정 원문을 교체하면(사람이 의도한 키 교체) 이어받기가 끝나 버전이 계정 secret_version 으로 바뀐다. */
  @Test
  void accountSecretReplaceAfterBackfillChangesVersion() throws Exception {
    long agent = podAgentWithLegacy("claude-code", "anthropic", claudeToken('R'));
    run(agent);
    long legacy = desiredVersions(agent).get("claude");
    runBackfill();
    assertThat(desiredVersions(agent).get("claude")).isEqualTo(legacy);
    long accountId = boundAccount(agent).orElseThrow();

    useTenant(TENANT);
    accountService.update(
        admin, accountId, new AgentAccountUpdateRequest(null, claudeToken('N'), null, null, null));

    long next = accountRow(accountId).secretVersion();
    assertThat(next).isNotEqualTo(legacy);
    assertThat(desiredVersions(agent).get("claude")).isEqualTo(next);
    assertThat(secretVersionOf(agent, "claude")).isEqualTo(next);
  }

  /** 관리자가 다른 계정으로 옮기면 이어받기가 지워진다 — 원래 계정으로 돌아와도 옛 연결 id 가 아니라 계정 버전이다. */
  @Test
  void adminRebindClearsOverride() throws Exception {
    long agent = podAgentWithLegacy("claude-code", "anthropic", claudeToken('B'));
    run(agent);
    long legacy = desiredVersions(agent).get("claude");
    runBackfill();
    long original = boundAccount(agent).orElseThrow();
    useTenant(TENANT);
    long other =
        accountService
            .register(
                admin,
                new AgentAccountRequest("anthropic", claudeToken('O'), null, null, null, null))
            .id();

    useTenant(TENANT);
    bindingService.bind(admin, agent, other);
    assertThat(desiredVersions(agent).get("claude")).isEqualTo(accountRow(other).secretVersion());

    useTenant(TENANT);
    bindingService.bind(admin, agent, original);
    long originalVersion = accountRow(original).secretVersion();
    assertThat(originalVersion).isNotEqualTo(legacy);
    assertThat(desiredVersions(agent).get("claude")).isEqualTo(originalVersion);
    assertThat(secretVersionOf(agent, "claude")).isEqualTo(originalVersion);
    useTenant(TENANT);
    AgentAccountBindingRepository.Binding binding = bindings.findBinding(agent).orElseThrow();
    assertThat(binding.versionIdOverride()).isNull();
    assertThat(binding.overrideSecretVersion()).isNull();
  }
}
