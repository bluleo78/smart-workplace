package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT;
import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;
import static com.workplace.jooq.Tables.AUDIT_LOG;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountRow;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountBindingService;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1450 Pod 용 로그인 엔드포인트 통합 테스트 — Pod 가 자기 AI 키로 묶인 로그인(auth.json)을 받아 가고({@code GET /me/login}),
 * 더 새 로그인을 올린다({@code PUT /me/login}). runner desired 의 {@code loginRevision} 도 본다. 모든 토큰은 가짜다.
 */
@Transactional
class AgentRuntimeLoginApiTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/agent-runtime/me/login";
  private static final String RUNNER = "/api/v1/agent-runtime/runner";
  private static final String LOGIN_TEMPLATE = "test-chatgpt";
  private static final String OLD = "2026-11-01T00:00:00Z";
  private static final String NEWER = "2026-11-05T00:00:00Z";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyService keyService;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountBindingService bindingService;
  @Autowired AgentAccountRepository accounts;
  @Autowired EncryptionService encryption;
  @Autowired AgentAccountBindingRepository bindingRepo;

  private long admin;
  private long agent;
  private long account;
  private String key;
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
    agent = newAgent();
    account = chatgptAccount("acc-1", "refresh-1", OLD);
    bind(agent, account);
    run(agent);
    key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
  }

  // ---- 준비 도우미 ----

  /** ChatGPT 로그인 템플릿으로 실행 설정한 AI 를 만든다. */
  private long newAgent() {
    return newAgentOn(LOGIN_TEMPLATE);
  }

  /** 가짜 Codex auth.json — account_id 가 계정 정체성이고 last_refresh 가 새로움의 기준이다. */
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
        + "\"},\"last_refresh\":\""
        + lastRefresh
        + "\"}";
  }

  private long chatgptAccount(String accountId, String refresh, String lastRefresh) {
    return accountService
        .register(
            admin,
            new AgentAccountRequest(
                "chatgpt", null, null, null, chatgptLogin(accountId, refresh, lastRefresh)))
        .id();
  }

  private void bind(long agentId, long accountId) {
    useTenant(1L);
    bindingService.bind(admin, agentId, accountId);
  }

  private void run(long agentId) {
    useTenant(1L);
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.DESIRED, "RUN")
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentId))
        .execute();
  }

  private AgentAccountRow row() {
    useTenant(1L);
    return accounts.findActive(account).orElseThrow();
  }

  private String stored() {
    return encryption.decrypt(row().encryptedSecret());
  }

  private ResultActions getLogin(String akKey, String query) throws Exception {
    useTenant(1L);
    ResultActions r = mvc.perform(get(URL + query).header("Authorization", "Bearer " + akKey));
    useTenant(1L);
    return r;
  }

  private ResultActions putLogin(String akKey, long version, String payload) throws Exception {
    useTenant(1L);
    String body = om.writeValueAsString(Map.of("version", version, "payload", payload));
    ResultActions r =
        mvc.perform(
            put(URL)
                .header("Authorization", "Bearer " + akKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    useTenant(1L);
    return r;
  }

  private JsonNode desiredAgent() throws Exception {
    useTenant(1L);
    JsonNode body =
        om.readTree(
            mvc.perform(get(RUNNER + "/desired").header("Authorization", "Bearer " + runnerToken))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString());
    useTenant(1L);
    for (JsonNode a : body.get("agents")) if (a.get("agentUserId").asLong() == agent) return a;
    throw new AssertionError("desired 에 AI 없음");
  }

  private long desiredLoginVersion() throws Exception {
    for (JsonNode s : desiredAgent().get("secrets")) {
      if ("login".equals(s.get("name").asText())) return s.get("version").asLong();
    }
    throw new AssertionError("desired 에 login 참조 없음");
  }

  // ---- GET ----

  /** 묶인 chatgpt AI 의 키로 받으면 원문·version(= desired 의 loginVersion)·revision 이 오고 캐시 금지다. */
  @Test
  void get_returnsBoundLoginWithDesiredVersion() throws Exception {
    String body =
        getLogin(key, "")
            .andExpect(status().isOk())
            .andExpect(
                header().string("Cache-Control", org.hamcrest.Matchers.containsString("no-store")))
            .andExpect(jsonPath("$.provider").value("chatgpt"))
            .andExpect(jsonPath("$.revision").value(row().loginRevision()))
            .andReturn()
            .getResponse()
            .getContentAsString();
    JsonNode json = om.readTree(body);
    assertThat(json.get("version").asLong()).isEqualTo(desiredLoginVersion());
    assertThat(om.readTree(json.get("payload").asText()).at("/tokens/refresh_token").asText())
        .isEqualTo("refresh-1");
  }

  /** 이미 가진 revision 이면 본문 없이 204. */
  @Test
  void get_sameRevision_is204() throws Exception {
    long rev = row().loginRevision();
    getLogin(key, "?revision=" + rev).andExpect(status().isNoContent());
    getLogin(key, "?revision=" + (rev - 1)).andExpect(status().isOk());
  }

  /** 계정에 묶이지 않은 AI 는 404. */
  @Test
  void get_unboundAgent_is404() throws Exception {
    long other = newAgent();
    String otherKey = keyService.issueManaged(other, 1L, null, null, "L1").plaintext();
    getLogin(otherKey, "")
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_LOGIN_NOT_FOUND"));
  }

  /** 사람 토큰은 403. */
  @Test
  void get_humanToken_is403() throws Exception {
    useTenant(1L);
    mvc.perform(
            get(URL)
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write"))))))
        .andExpect(status().isForbidden());
  }

  // ---- PUT ----

  /** 더 새 last_refresh 면 저장 — 내용이 바뀌고 secret_version 은 그대로, revision +1, NEEDS_CHECK 는 ACTIVE. */
  @Test
  void put_newer_saves_andKeepsSecretVersion() throws Exception {
    useTenant(1L);
    accounts.updateStatus(account, AgentAccountService.STATUS_NEEDS_CHECK);
    AgentAccountRow before = row();
    long version = desiredLoginVersion();

    putLogin(key, version, chatgptLogin("acc-1", "refresh-2", NEWER))
        .andExpect(status().isNoContent());

    AgentAccountRow after = row();
    assertThat(after.secretVersion()).isEqualTo(before.secretVersion());
    assertThat(after.loginRevision()).isEqualTo(before.loginRevision() + 1);
    assertThat(after.status()).isEqualTo(AgentAccountService.STATUS_ACTIVE);
    assertThat(om.readTree(stored()).at("/tokens/refresh_token").asText()).isEqualTo("refresh-2");
    assertThat(after.lastRefreshedAt()).isEqualTo(OffsetDateTime.parse(NEWER).toInstant());
    // desired 의 loginVersion 은 그대로, loginRevision 만 바뀐다.
    assertThat(desiredLoginVersion()).isEqualTo(version);
    assertThat(desiredAgent().get("loginRevision").asLong()).isEqualTo(after.loginRevision());
  }

  /** 관리자 API 로 등록한 계정은 서버 갱신 준비(server_refresh_ready)가 true 다. */
  @Test
  void adminRegisteredAccount_isServerRefreshReady() {
    useTenant(1L);
    assertThat(row().serverRefreshReady()).isTrue();
  }

  /** 사람이 원문을 교체하면 준비 표시가 true — 이관 백필처럼 false 였던 계정도. */
  @Test
  void replaceSecret_marksServerRefreshReady() {
    useTenant(1L);
    dsl.execute("UPDATE agent_account SET server_refresh_ready = false WHERE id = ?", account);
    assertThat(row().serverRefreshReady()).isFalse();

    accountService.update(
        admin,
        account,
        new AgentAccountUpdateRequest(
            null, null, null, chatgptLogin("acc-1", "refresh-human", NEWER)));

    assertThat(row().serverRefreshReady()).isTrue();
  }

  /** Pod 올리기가 저장되면 준비 표시가 true — 거절되면 그대로 false. */
  @Test
  void podUpload_marksServerRefreshReady_onlyWhenSaved() throws Exception {
    useTenant(1L);
    dsl.execute("UPDATE agent_account SET server_refresh_ready = false WHERE id = ?", account);
    long version = desiredLoginVersion();

    putLogin(key, version, chatgptLogin("acc-1", "refresh-old", OLD))
        .andExpect(status().isConflict());
    assertThat(row().serverRefreshReady()).isFalse();

    putLogin(key, version, chatgptLogin("acc-1", "refresh-2", NEWER))
        .andExpect(status().isNoContent());
    assertThat(row().serverRefreshReady()).isTrue();
  }

  /** RELOGIN_REQUIRED 도 더 새 로그인이 들어오면 ACTIVE. */
  @Test
  void put_newer_clearsReloginRequired() throws Exception {
    useTenant(1L);
    accounts.updateStatus(account, AgentAccountService.STATUS_RELOGIN_REQUIRED);
    putLogin(key, desiredLoginVersion(), chatgptLogin("acc-1", "refresh-2", NEWER))
        .andExpect(status().isNoContent());
    assertThat(row().status()).isEqualTo(AgentAccountService.STATUS_ACTIVE);
  }

  /** 같은·옛 last_refresh 는 409 NOT_NEWER, 저장본 불변. */
  @Test
  void put_sameOrOlder_isRejected() throws Exception {
    long version = desiredLoginVersion();
    String before = stored();
    putLogin(key, version, chatgptLogin("acc-1", "refresh-x", OLD))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AGENT_LOGIN_REJECTED"))
        .andExpect(jsonPath("$.errors.reason").value("NOT_NEWER"));
    putLogin(key, version, chatgptLogin("acc-1", "refresh-x", "2026-10-01T00:00:00Z"))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("NOT_NEWER"));
    assertThat(stored()).isEqualTo(before);
  }

  /** 다른 account_id 는 409 ACCOUNT_MISMATCH. */
  @Test
  void put_otherAccountId_isRejected() throws Exception {
    String before = stored();
    putLogin(key, desiredLoginVersion(), chatgptLogin("acc-other", "refresh-x", NEWER))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("ACCOUNT_MISMATCH"));
    assertThat(stored()).isEqualTo(before);
  }

  /** 틀린 version 은 409 VERSION_MISMATCH — 선택이 바뀐 직후의 Pod. */
  @Test
  void put_wrongVersion_isRejected() throws Exception {
    long before = row().loginRevision();
    putLogin(key, desiredLoginVersion() + 1, chatgptLogin("acc-1", "refresh-x", NEWER))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("VERSION_MISMATCH"));
    assertThat(row().loginRevision()).isEqualTo(before);
  }

  /** auth.json 이 아닌 값은 409 INVALID, ChatGPT 가 아닌 계정은 NOT_CHATGPT. 응답에 원문이 없다. */
  @Test
  void put_invalidPayload_isRejectedWithoutEchoingIt() throws Exception {
    String body =
        putLogin(key, desiredLoginVersion(), "not-json-secret-value")
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.errors.reason").value("INVALID"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    assertThat(body).doesNotContain("not-json-secret-value");
  }

  /** 안 묶인 AI 는 404. */
  @Test
  void put_unboundAgent_is404() throws Exception {
    long other = newAgent();
    String otherKey = keyService.issueManaged(other, 1L, null, null, "L1").plaintext();
    putLogin(otherKey, 1L, chatgptLogin("acc-1", "refresh-x", NEWER))
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_LOGIN_NOT_FOUND"));
  }

  // ---- fix round 1 ----

  private static final String GENIA_LOGIN =
      "{\"genia\":{\"type\":\"oauth\",\"refresh\":\"genia-refresh\",\"access\":\"genia-access\","
          + "\"expires\":4102444800000}}";

  /** genia 계정에 묶인 AI 와 그 AI 키. */
  private String geniaAgentKey() {
    long g = newAgentOn("genia-code");
    long ga =
        accountService
            .register(admin, new AgentAccountRequest("genia", null, null, null, GENIA_LOGIN))
            .id();
    bind(g, ga);
    run(g);
    return keyService.issueManaged(g, 1L, null, null, "L1").plaintext();
  }

  private long newAgentOn(String template) {
    useTenant(1L);
    long id = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, id, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
    return id;
  }

  /** 성공한 올리기는 감사 행을 남기고(source·revision·상태 변화), 토큰은 어디에도 없다. */
  @Test
  void put_success_writesAuditWithoutTokens() throws Exception {
    useTenant(1L);
    accounts.updateStatus(account, AgentAccountService.STATUS_NEEDS_CHECK);
    putLogin(key, desiredLoginVersion(), chatgptLogin("acc-1", "refresh-secret-2", NEWER))
        .andExpect(status().isNoContent());
    useTenant(1L);
    var rows =
        dsl.select(AUDIT_LOG.DESCRIPTION, AUDIT_LOG.METADATA, AUDIT_LOG.ACTION_TYPE)
            .from(AUDIT_LOG)
            .where(AUDIT_LOG.RESOURCE_ID.eq(String.valueOf(account)))
            .and(AUDIT_LOG.METADATA.cast(String.class).contains("pod-upload"))
            .fetch();
    assertThat(rows).hasSize(1);
    String meta = rows.get(0).value2().data();
    assertThat(rows.get(0).value3()).isEqualTo("AGENT_ACCOUNT_UPDATED");
    assertThat(meta).contains("\"revision\"").contains("NEEDS_CHECK");
    assertThat(meta + rows.get(0).value1())
        .doesNotContain("refresh-secret-2")
        .doesNotContain("refresh-1")
        .doesNotContain("fake-access");
  }

  /** 저장본이나 올린 값에 account_id 가 없으면 같은 계정임을 알 수 없어 거절한다(둘 다 없어도). */
  @Test
  void put_missingAccountId_isRejected() throws Exception {
    long version = desiredLoginVersion();
    String noId = chatgptLogin("x", "refresh-x", NEWER).replace(",\"account_id\":\"x\"", "");
    putLogin(key, version, noId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("ACCOUNT_MISMATCH"));

    // 저장본에도 account_id 가 없는 계정 — 둘 다 null 이어도 거절.
    long other = newAgentOn(LOGIN_TEMPLATE);
    long noIdAccount =
        accountService
            .register(
                admin,
                new AgentAccountRequest(
                    "chatgpt",
                    null,
                    null,
                    null,
                    chatgptLogin("y", "refresh-y", OLD).replace(",\"account_id\":\"y\"", "")))
            .id();
    bind(other, noIdAccount);
    run(other);
    String otherKey = keyService.issueManaged(other, 1L, null, null, "L1").plaintext();
    long otherVersion =
        om.readTree(getLogin(otherKey, "").andReturn().getResponse().getContentAsString())
            .get("version")
            .asLong();
    putLogin(otherKey, otherVersion, noId)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("ACCOUNT_MISMATCH"));
  }

  /** 저장본 암호문이 깨졌으면 GET·PUT 모두 500 이 아니라 404. */
  @Test
  void corruptStoredSecret_is404NotServerError() throws Exception {
    long version = desiredLoginVersion();
    useTenant(1L);
    dsl.update(AGENT_ACCOUNT)
        .set(AGENT_ACCOUNT.ENCRYPTED_SECRET, "broken-ciphertext")
        .where(AGENT_ACCOUNT.ID.eq(account))
        .execute();
    getLogin(key, "").andExpect(status().isNotFound());
    putLogin(key, version, chatgptLogin("acc-1", "refresh-x", NEWER))
        .andExpect(status().isNotFound());
  }

  /** genia 계정: GET 은 200, PUT 은 409 NOT_CHATGPT. */
  @Test
  void geniaAccount_getOk_putNotChatgpt() throws Exception {
    String gKey = geniaAgentKey();
    String body =
        getLogin(gKey, "")
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.provider").value("genia"))
            .andReturn()
            .getResponse()
            .getContentAsString();
    long v = om.readTree(body).get("version").asLong();
    putLogin(gKey, v, GENIA_LOGIN)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.reason").value("NOT_CHATGPT"));
  }

  /** 사람 토큰으로 PUT 하면 403. */
  @Test
  void put_humanToken_is403() throws Exception {
    useTenant(1L);
    mvc.perform(
            put(URL)
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write")))))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"version\":1,\"payload\":\"x\"}"))
        .andExpect(status().isForbidden());
  }

  /** 이관 override 가 있는 묶음 — GET version 이 desired loginVersion 과 같고(override 값) 그 값으로 올릴 수 있다. */
  @Test
  void legacyOverride_versionMatchesDesired() throws Exception {
    useTenant(1L);
    bindingRepo.upsert(agent, account, admin, 987_654L, row().secretVersion());
    assertThat(desiredLoginVersion()).isEqualTo(987_654L);
    getLogin(key, "").andExpect(jsonPath("$.version").value(987_654L));
    putLogin(key, 987_654L, chatgptLogin("acc-1", "refresh-2", NEWER))
        .andExpect(status().isNoContent());
  }

  /** GET·PUT 중 어떤 로그에도 토큰 원문이 없다. */
  @Test
  void noPlaintextInLogs() throws Exception {
    Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    Logger app = (Logger) LoggerFactory.getLogger("com.workplace");
    Level saved = app.getLevel();
    ListAppender<ILoggingEvent> logs = new ListAppender<>();
    logs.start();
    app.setLevel(Level.DEBUG);
    root.addAppender(logs);
    try {
      long version = desiredLoginVersion();
      getLogin(key, "").andExpect(status().isOk());
      putLogin(key, version, chatgptLogin("acc-1", "refresh-LEAK-2", NEWER))
          .andExpect(status().isNoContent());
      putLogin(key, version, chatgptLogin("acc-other", "refresh-LEAK-3", NEWER))
          .andExpect(status().isConflict());
      putLogin(key, version, "garbage-LEAK-4").andExpect(status().isConflict());
    } finally {
      root.detachAppender(logs);
      app.setLevel(saved);
    }
    assertThat(logs.list).isNotEmpty();
    for (ILoggingEvent e : logs.list) {
      String text =
          e.getFormattedMessage()
              + (e.getThrowableProxy() == null ? "" : e.getThrowableProxy().getMessage());
      assertThat(text)
          .doesNotContain("refresh-1")
          .doesNotContain("LEAK")
          .doesNotContain("fake-access");
    }
  }
}
