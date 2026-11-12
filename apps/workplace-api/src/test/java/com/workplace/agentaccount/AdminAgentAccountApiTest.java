package com.workplace.agentaccount;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.repository.AgentAccountBindingRepository;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1448 AI 계정 목록 관리자 API 통합 테스트 — 등록(원문은 응답에 없음·종류별 검증), 목록의 쓰는 AI, 라벨만/원문 교체 수정, 폐기(쓰는 AI 가 있으면
 * 409), 같은 키 중복 등록 409, 다른 워크스페이스 계정 404, 관리자 아님 403. 키 값은 모두 가짜다.
 */
@Transactional
class AdminAgentAccountApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/admin/agent-accounts";
  private static final String TOKEN = "sk-ant-oat01-" + "F".repeat(40);

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentAccountBindingRepository bindings;

  private long admin;

  /** 워크스페이스 1 의 관리자를 시드한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
  }

  /** 웹 로그인 세션 인증(user:write) — 쓰기 API 가 @RequireWebSession 이다. */
  private Authentication auth(long userId) {
    return WebSessionAuth.of(userId, List.of(new SimpleGrantedAuthority("user:write")));
  }

  /** 요청 필터가 끝나면 TenantContext 가 비워지므로 매 호출 전에 테넌트를 다시 맞춘다. */
  private ResultActions call(MockHttpServletRequestBuilder b, long caller) throws Exception {
    TenantContext.set(1L);
    return mvc.perform(b.with(authentication(auth(caller))));
  }

  private ResultActions register(AgentAccountRequest req) throws Exception {
    return call(
        post(BASE).contentType(MediaType.APPLICATION_JSON).content(om.writeValueAsString(req)),
        admin);
  }

  private ResultActions update(long id, AgentAccountUpdateRequest req) throws Exception {
    return call(
        patch(BASE + "/" + id)
            .contentType(MediaType.APPLICATION_JSON)
            .content(om.writeValueAsString(req)),
        admin);
  }

  private JsonNode json(ResultActions r) throws Exception {
    return om.readTree(r.andReturn().getResponse().getContentAsString());
  }

  private long registerAnthropic(String token, String label) throws Exception {
    return json(register(new AgentAccountRequest("anthropic", token, null, label, null, null))
            .andExpect(status().isCreated()))
        .get("id")
        .asLong();
  }

  /** 가짜 id_token — 본문에 email 만 둔 서명 없는 JWT 모양. */
  private static String fakeIdToken(String email) {
    Base64.Encoder enc = Base64.getUrlEncoder().withoutPadding();
    String header = enc.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8));
    String body =
        enc.encodeToString(("{\"email\":\"" + email + "\"}").getBytes(StandardCharsets.UTF_8));
    return header + "." + body + ".sig";
  }

  /** Codex 가 남기는 auth.json 모양(가짜 값). */
  private static String chatgptAuthJson(String email, String accountId) {
    return chatgptAuthJson(email, accountId, "fake-refresh-SECRET");
  }

  /** 갱신 토큰까지 고르는 auth.json(가짜 값) — 같은 로그인의 다른 갱신본을 만들 때 쓴다. */
  private static String chatgptAuthJson(String email, String accountId, String refresh) {
    return "{\"auth_mode\":\"chatgpt\",\"OPENAI_API_KEY\":null,"
        + "\"tokens\":{\"id_token\":\""
        + fakeIdToken(email)
        + "\",\"access_token\":\"fake-access\",\"refresh_token\":\""
        + refresh
        + "\","
        + "\"account_id\":\""
        + accountId
        + "\"},\"last_refresh\":\"2026-11-01T00:00:00Z\"}";
  }

  private long secretVersion(long id) {
    return accounts.findActive(id).orElseThrow().secretVersion();
  }

  @Test
  void registerAnthropicReturnsMetaWithoutSecret() throws Exception {
    ResultActions r =
        register(new AgentAccountRequest("anthropic", TOKEN, null, "팀 구독", null, null))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider").value("anthropic"))
            .andExpect(jsonPath("$.label").value("팀 구독"))
            .andExpect(jsonPath("$.status").value("ACTIVE"))
            .andExpect(jsonPath("$.agents").isEmpty());

    assertThat(r.andReturn().getResponse().getContentAsString()).doesNotContain(TOKEN);
  }

  @Test
  void registerWithoutLabelUsesProviderLabel() throws Exception {
    register(new AgentAccountRequest("anthropic", TOKEN, null, " ", null, null))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.label").value("Claude 구독 계정"));
  }

  @Test
  void registerChatgptNormalizesLoginInfo() throws Exception {
    register(new AgentAccountRequest("chatgpt", null, null, null, "{\"nope\":1}", null))
        .andExpect(status().isBadRequest());

    ResultActions ok =
        register(
                new AgentAccountRequest(
                    "chatgpt", null, null, "코덱스", chatgptAuthJson("a@example.test", "acc-1"), null))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider").value("chatgpt"))
            .andExpect(jsonPath("$.accountEmail").value("a@example.test"))
            .andExpect(jsonPath("$.lastRefreshedAt").value("2026-11-01T00:00:00Z"));
    assertThat(ok.andReturn().getResponse().getContentAsString())
        .doesNotContain("fake-refresh-SECRET");
  }

  @Test
  void registerOpencodeRejectsPodUnsafeProviderId() throws Exception {
    var bad =
        new ProviderConfig(
            "a b", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    register(new AgentAccountRequest("opencode", null, bad, null, null, null))
        .andExpect(status().isBadRequest());

    var good =
        new ProviderConfig(
            "custom", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    register(new AgentAccountRequest("opencode", null, good, null, null, null))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.label").value("OpenAI 호환 계정"));
  }

  @Test
  void registerDuplicateKeyIsConflict() throws Exception {
    registerAnthropic(TOKEN, "첫째");

    register(new AgentAccountRequest("anthropic", TOKEN, null, "둘째", null, null))
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_DUPLICATE"));

    // ChatGPT 는 같은 account_id·같은 사람(이메일)이면 다른 토큰이어도 같은 계정이다.
    register(
            new AgentAccountRequest(
                "chatgpt", null, null, null, chatgptAuthJson("a@x.test", "A", "refresh-1"), null))
        .andExpect(status().isCreated());
    register(
            new AgentAccountRequest(
                "chatgpt", null, null, null, chatgptAuthJson("a@x.test", "A", "refresh-2"), null))
        .andExpect(status().isConflict());
  }

  /**
   * ChatGPT Team·Enterprise 는 account_id 가 워크스페이스 id 라 여러 사람이 같은 값을 가진다 — 같은 account_id 라도 로그인한
   * 사람(이메일)이 다르면 서로 다른 계정이다(409 아님).
   */
  @Test
  void chatgptSameWorkspaceDifferentUsersAreDifferentAccounts() throws Exception {
    long first =
        json(register(
                    new AgentAccountRequest(
                        "chatgpt", null, null, "가", chatgptAuthJson("a@team.test", "WS-1"), null))
                .andExpect(status().isCreated()))
            .get("id")
            .asLong();
    long second =
        json(register(
                    new AgentAccountRequest(
                        "chatgpt", null, null, "나", chatgptAuthJson("b@team.test", "WS-1"), null))
                .andExpect(status().isCreated()))
            .get("id")
            .asLong();

    assertThat(second).isNotEqualTo(first);
    assertThat(accounts.findActive(first).orElseThrow().accountEmail()).isEqualTo("a@team.test");
    assertThat(accounts.findActive(second).orElseThrow().accountEmail()).isEqualTo("b@team.test");
  }

  @Test
  void listShowsBoundAgents() throws Exception {
    long acc = registerAnthropic(TOKEN, "공유");
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    bindings.upsert(agent, acc, admin, null, null);

    call(get(BASE), admin)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id==" + acc + ")].agents[0].userId").value((int) agent));
    call(get(BASE + "/" + acc), admin)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.agents[0].userId").value((int) agent))
        .andExpect(jsonPath("$.agents[0].username").isNotEmpty());
  }

  /** Gen:iA 붙여 넣기 auth.json(가짜 값) — 브라우저 로그인(WP-1461)이 만드는 것과 같은 모양. */
  private static String geniaAuthJson(String access, String email) {
    return "{\"genia\":{\"type\":\"oauth\",\"access\":\""
        + access
        + "\",\"refresh\":\""
        + access
        + "\",\"expires\":1797033600000,\"email\":\""
        + email
        + "\"}}";
  }

  /** WP-1461 회귀 고정 — 브라우저 로그인을 더해도 Gen:iA 붙여 넣기 등록은 그대로 된다. */
  @Test
  void registerGeniaPasteStillWorks() throws Exception {
    ResultActions r =
        register(
                new AgentAccountRequest(
                    "genia", null, null, null, geniaAuthJson("a", "paste@iacloud.kr"), null))
            .andExpect(status().isCreated())
            .andExpect(jsonPath("$.provider").value("genia"))
            .andExpect(jsonPath("$.accountEmail").value("paste@iacloud.kr"));
    assertThat(r.andReturn().getResponse().getContentAsString()).doesNotContain("\"a\"");
  }

  /** WP-1461 회귀 고정 — Gen:iA 계정의 붙여 넣기 키 교체(PATCH)도 그대로 된다. */
  @Test
  void patchGeniaPasteStillReplaces() throws Exception {
    long acc =
        json(register(
                    new AgentAccountRequest(
                        "genia", null, null, "젠", geniaAuthJson("a", "paste@iacloud.kr"), null))
                .andExpect(status().isCreated()))
            .get("id")
            .asLong();
    long before = secretVersion(acc);

    update(
            acc,
            new AgentAccountUpdateRequest(
                null, null, null, geniaAuthJson("b", "other@iacloud.kr"), null))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accountEmail").value("other@iacloud.kr"));

    assertThat(secretVersion(acc)).isGreaterThan(before);
  }

  @Test
  void patchLabelOnlyKeepsSecretVersion() throws Exception {
    long acc = registerAnthropic(TOKEN, "옛 이름");
    long before = secretVersion(acc);

    update(acc, new AgentAccountUpdateRequest("새 이름", null, null, null, null))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.label").value("새 이름"));

    assertThat(secretVersion(acc)).isEqualTo(before);
  }

  @Test
  void patchSecretReplacesVersion() throws Exception {
    long acc = registerAnthropic(TOKEN, "구독");
    long before = secretVersion(acc);
    String newToken = "sk-ant-oat01-" + "G".repeat(40);

    ResultActions r =
        update(acc, new AgentAccountUpdateRequest(null, newToken, null, null, null))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.label").value("구독"));

    assertThat(secretVersion(acc)).isGreaterThan(before);
    assertThat(r.andReturn().getResponse().getContentAsString()).doesNotContain(newToken);
    // 짧은 토큰은 400 — 등록과 같은 검증.
    update(acc, new AgentAccountUpdateRequest(null, "short", null, null, null))
        .andExpect(status().isBadRequest());
  }

  @Test
  void patchSecretToOtherAccountsKeyIsConflict() throws Exception {
    registerAnthropic(TOKEN, "첫째");
    long second = registerAnthropic("sk-ant-oat01-" + "H".repeat(40), "둘째");

    update(second, new AgentAccountUpdateRequest(null, TOKEN, null, null, null))
        .andExpect(status().isConflict());
  }

  @Test
  void revokeInUseAccountIsConflict() throws Exception {
    long acc = registerAnthropic(TOKEN, "쓰는 중");
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    bindings.upsert(agent, acc, admin, null, null);

    call(delete(BASE + "/" + acc), admin)
        .andExpect(status().isConflict())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_IN_USE"));

    assertThat(accounts.findActive(acc)).isPresent();
  }

  @Test
  void revokeUnusedAccountHidesFromList() throws Exception {
    long acc = registerAnthropic(TOKEN, "안 씀");

    call(delete(BASE + "/" + acc), admin).andExpect(status().isNoContent());

    call(get(BASE), admin)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$[?(@.id==" + acc + ")]").isEmpty());
    call(get(BASE + "/" + acc), admin).andExpect(status().isNotFound());
    // 폐기된 계정과 같은 키는 다시 등록할 수 있다.
    registerAnthropic(TOKEN, "다시");
  }

  @Test
  void otherTenantAccountIsNotFound() throws Exception {
    long tenant2 = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(tenant2);
    long foreign =
        accounts.insert(
            "anthropic", "남의 계정", "iv:cipher", null, null, "ACTIVE", null, null, false, null);
    useTenant(1L);

    call(get(BASE + "/" + foreign), admin)
        .andExpect(status().isNotFound())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ACCOUNT_NOT_FOUND"));
    update(foreign, new AgentAccountUpdateRequest("가로채기", null, null, null, null))
        .andExpect(status().isNotFound());
    call(delete(BASE + "/" + foreign), admin).andExpect(status().isNotFound());
  }

  @Test
  void nonAdminForbidden() throws Exception {
    long member = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));

    call(get(BASE), member).andExpect(status().isForbidden());
    call(
            post(BASE)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        new AgentAccountRequest("anthropic", TOKEN, null, null, null, null))),
            member)
        .andExpect(status().isForbidden());
  }

  @Test
  void requestToStringHidesSecrets() {
    var req = new AgentAccountRequest("anthropic", TOKEN, null, "라벨", "{\"x\":1}", null);
    var upd = new AgentAccountUpdateRequest("라벨", TOKEN, null, "{\"x\":1}", null);

    assertThat(req.toString()).doesNotContain(TOKEN).doesNotContain("{\"x\"").contains("라벨");
    assertThat(upd.toString()).doesNotContain(TOKEN).doesNotContain("{\"x\"");
  }
}
