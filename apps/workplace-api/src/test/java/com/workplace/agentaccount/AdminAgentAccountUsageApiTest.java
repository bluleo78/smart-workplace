package com.workplace.agentaccount;

import static com.workplace.jooq.Tables.AGENT_ACCOUNT_USAGE_CHECK;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.dto.AgentAccountUpdateRequest;
import com.workplace.agentaccount.service.AgentAccountBindingService;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentaccount.usage.AgentAccountUsageRepository;
import com.workplace.agentaccount.usage.UsageSnapshot;
import com.workplace.agentaccount.usage.UsageWindow;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1449 계정 목록 응답의 사용량 블록 통합 테스트 — 저장소에 심어 둔 스냅샷·실패가 {@code usage} 의 상태·창·실패 이유로 실리고, 응답 본문에 등록한
 * 토큰·auth.json 의 access_token·refresh_token 이 없으며, runner {@code /observed} 가 RUNNING 으로 보고한 AI 가
 * 묶인 계정의 마지막 사용 시각이 채워지며, 키를 바꾸면(PATCH) 옛 키의 사용량·실패가 비워져 「모름」이 되는지 본다. 키 값은 모두 가짜다.
 */
@Transactional
class AdminAgentAccountUsageApiTest extends IntegrationTestBase {

  private static final String BASE = "/api/v1/admin/agent-accounts";
  private static final String RUNNER = "/api/v1/agent-runtime/runner";
  private static final String TOKEN = "sk-ant-oat01-" + "U".repeat(40);
  private static final String ACCESS = "fake-access-USAGE";
  private static final String REFRESH = "fake-refresh-USAGE";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentAccountService accountService;
  @Autowired AgentAccountBindingService bindingService;
  @Autowired AgentAccountUsageRepository usage;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;

  private long admin;

  /** 워크스페이스 1 의 관리자를 시드한다. */
  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
  }

  /** 관리자 세션으로 목록을 읽어 계정 id → 항목으로 돌려준다. 원문 검사를 위해 본문 문자열도 함께 본다. */
  private String listBody() throws Exception {
    TenantContext.set(1L);
    String body =
        mvc.perform(
                get(BASE)
                    .with(
                        authentication(
                            WebSessionAuth.of(
                                admin, List.of(new SimpleGrantedAuthority("user:write"))))))
            .andExpect(status().isOk())
            .andReturn()
            .getResponse()
            .getContentAsString();
    TenantContext.set(1L);
    return body;
  }

  private JsonNode item(String body, long id) throws Exception {
    for (JsonNode n : om.readTree(body)) {
      if (n.get("id").asLong() == id) return n;
    }
    throw new AssertionError("목록에 계정이 없다: " + id);
  }

  /** 가짜 Codex auth.json — access_token·refresh_token 은 응답에 나오면 안 되는 값이다. */
  private static String chatgptAuthJson() {
    Base64.Encoder enc = Base64.getUrlEncoder().withoutPadding();
    String idToken =
        enc.encodeToString("{\"alg\":\"none\"}".getBytes(StandardCharsets.UTF_8))
            + "."
            + enc.encodeToString("{\"email\":\"u@example.test\"}".getBytes(StandardCharsets.UTF_8))
            + ".sig";
    return "{\"auth_mode\":\"chatgpt\",\"OPENAI_API_KEY\":null,\"tokens\":{\"id_token\":\""
        + idToken
        + "\",\"access_token\":\""
        + ACCESS
        + "\",\"refresh_token\":\""
        + REFRESH
        + "\",\"account_id\":\"acct-usage\"}}";
  }

  private static UsageSnapshot snap(UsageWindow w, String pct, Instant resets, Instant at) {
    return new UsageSnapshot(w, new BigDecimal(pct), resets, "allowed", at);
  }

  @Test
  void listCarriesUsageAndNoPlaintext() throws Exception {
    long claude =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", TOKEN, null, "구독", null))
            .id();
    long chatgpt =
        accountService
            .register(
                admin, new AgentAccountRequest("chatgpt", null, null, null, chatgptAuthJson()))
            .id();
    Instant t0 = Instant.parse("2026-11-09T00:00:00Z");
    // 초기화 시각은 지금 기준 미래로 둔다 — 지난 창은 상태 판정에서 빠지므로(날짜가 지나도 테스트가 흔들리지 않게)
    Instant base = Instant.now().truncatedTo(ChronoUnit.SECONDS);
    Instant fiveReset = base.plus(5, ChronoUnit.HOURS);
    Instant weekReset = base.plus(6, ChronoUnit.DAYS);
    // Claude: 성공 뒤 실패 — 상태는 CHECK_FAILED, 마지막 성공 값은 함께 실린다
    usage.saveSuccess(
        claude,
        List.of(
            snap(UsageWindow.FIVE_HOUR, "42.50", fiveReset, t0),
            snap(UsageWindow.WEEKLY, "60.00", weekReset, t0)),
        false);
    usage.saveFailure(claude, "TOKEN_EXPIRED", "확인 실패(토큰 만료)");
    // 시도·성공 시각은 DB now() 로 쓰이므로(테스트 트랜잭션 안에서는 같은 값) 응답 확인용으로 고정 값을 심는다
    dsl.update(AGENT_ACCOUNT_USAGE_CHECK)
        .set(AGENT_ACCOUNT_USAGE_CHECK.SUCCEEDED_AT, t0.atOffset(ZoneOffset.UTC))
        .set(AGENT_ACCOUNT_USAGE_CHECK.CHECKED_AT, t0.plusSeconds(600).atOffset(ZoneOffset.UTC))
        .where(AGENT_ACCOUNT_USAGE_CHECK.ACCOUNT_ID.eq(claude))
        .execute();
    // ChatGPT: 성공(주간 80%) — 임박
    usage.saveSuccess(
        chatgpt,
        List.of(
            snap(UsageWindow.FIVE_HOUR, "10.00", fiveReset, t0),
            snap(UsageWindow.WEEKLY, "80.00", weekReset, t0)),
        false);

    String body = listBody();

    JsonNode c = item(body, claude).get("usage");
    assertThat(c.get("status").asText()).isEqualTo("CHECK_FAILED");
    assertThat(c.get("fiveHour").get("usedPercent").decimalValue())
        .isEqualByComparingTo(new BigDecimal("42.50"));
    assertThat(Instant.parse(c.get("weekly").get("resetsAt").asText())).isEqualTo(weekReset);
    assertThat(c.get("errorCode").asText()).isEqualTo("TOKEN_EXPIRED");
    assertThat(Instant.parse(c.get("succeededAt").asText())).isEqualTo(t0);
    assertThat(Instant.parse(c.get("checkedAt").asText())).isEqualTo(t0.plusSeconds(600));

    JsonNode g = item(body, chatgpt).get("usage");
    assertThat(g.get("status").asText()).isEqualTo("NEAR_LIMIT");
    assertThat(g.get("errorCode").isNull()).isTrue();
    assertThat(g.get("weekly").get("usedPercent").decimalValue())
        .isEqualByComparingTo(new BigDecimal("80.00"));

    // 원문은 어디에도 없다
    assertThat(body).doesNotContain(TOKEN).doesNotContain(ACCESS).doesNotContain(REFRESH);
  }

  @Test
  void replacingSecretClearsUsage() throws Exception {
    long claude =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", TOKEN, null, "교체", null))
            .id();
    Instant base = Instant.now().truncatedTo(ChronoUnit.SECONDS);
    // 옛 키의 사용량(95%·한도 도달)과 마지막 실패를 심는다
    usage.saveSuccess(
        claude,
        List.of(snap(UsageWindow.FIVE_HOUR, "95.00", base.plus(1, ChronoUnit.HOURS), base)),
        true);
    usage.saveFailure(claude, "UNAUTHORIZED", "토큰이 거절됨");
    assertThat(item(listBody(), claude).get("usage").get("status").asText())
        .isEqualTo("CHECK_FAILED");

    // 관리자가 PATCH 로 토큰을 바꾼다
    String newToken = "sk-ant-oat01-" + "N".repeat(40);
    TenantContext.set(1L);
    mvc.perform(
            patch(BASE + "/" + claude)
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write")))))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        new AgentAccountUpdateRequest(null, newToken, null, null))))
        .andExpect(status().isOk());

    // 옛 키의 값은 사라지고 「모름」 — 창·실패 이유 없음
    JsonNode u = item(listBody(), claude).get("usage");
    assertThat(u.get("status").asText()).isEqualTo("UNKNOWN");
    assertThat(u.get("fiveHour").isNull()).isTrue();
    assertThat(u.get("weekly").isNull()).isTrue();
    assertThat(u.get("errorCode").isNull()).isTrue();
    assertThat(u.get("errorMessage").isNull()).isTrue();
    assertThat(u.get("checkedAt").isNull()).isTrue();
  }

  @Test
  void accountWithoutRecordIsUnknownWithNullWindows() throws Exception {
    long claude =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", TOKEN, null, null, null))
            .id();
    JsonNode u = item(listBody(), claude).get("usage");
    assertThat(u.get("status").asText()).isEqualTo("UNKNOWN");
    assertThat(u.get("fiveHour").isNull()).isTrue();
    assertThat(u.get("weekly").isNull()).isTrue();
    assertThat(u.get("lastUsedAt").isNull()).isTrue();
  }

  @Test
  void runnerObservedRunningFillsLastUsedOfBoundAccount() throws Exception {
    String runnerToken =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .plaintextToken();
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
                    null))
            .id();
    useTenant(1L);
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("opencode", null, Map.of(), null));
    useTenant(1L);
    bindingService.bind(admin, agent, acc);

    JsonNode before = item(listBody(), acc).get("usage");
    assertThat(before.get("status").asText()).isEqualTo("UNLIMITED");
    assertThat(before.get("lastUsedAt").isNull()).isTrue();

    useTenant(1L);
    mvc.perform(
            post(RUNNER + "/observed")
                .header("Authorization", "Bearer " + runnerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"agents\":[{\"agentUserId\":" + agent + ",\"phase\":\"RUNNING\"}]}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.updated").value(1));

    JsonNode after = item(listBody(), acc).get("usage");
    assertThat(after.get("status").asText()).isEqualTo("UNLIMITED");
    assertThat(after.get("lastUsedAt").isNull()).isFalse();
  }

  @Test
  void runnerObservedStoppedDoesNotTouchLastUsed() throws Exception {
    String runnerToken =
        locationService
            .create(admin, new CreateAgentLocationRequest("L1", null, 5))
            .plaintextToken();
    long claude =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", TOKEN, null, null, null))
            .id();
    useTenant(1L);
    long agent =
        TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("claude-code", null, Map.of(), null));
    useTenant(1L);
    bindingService.bind(admin, agent, claude);

    useTenant(1L);
    mvc.perform(
            post(RUNNER + "/observed")
                .header("Authorization", "Bearer " + runnerToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"agents\":[{\"agentUserId\":" + agent + ",\"phase\":\"STOPPED\"}]}"))
        .andExpect(status().isOk());

    assertThat(item(listBody(), claude).get("usage").get("lastUsedAt").isNull()).isTrue();
  }
}
