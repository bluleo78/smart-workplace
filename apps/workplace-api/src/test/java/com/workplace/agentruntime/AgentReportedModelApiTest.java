package com.workplace.agentruntime;

import static com.workplace.jooq.Tables.AGENT_REPORTED_MODEL;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.CreateAgentLocationRequest;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentLocationService;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.auth.service.AiAgentCredentialService;
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
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1297 로그인 계정 모델 목록 보고 API 통합 테스트 — Pod 가 자기 AI 키로 {@code PUT /agent-runtime/me/models} 로 목록을
 * 보고하면 저장하고(덮어쓴다), 관리자 모델 목록 조회가 그 목록을 돌려준다. 연결을 바꾸면 옛 보고는 무시되고, 로그인 계정이 아닌 AI 의 보고는 저장하지 않는다. 로그인
 * 값은 모두 가짜다.
 *
 * <p>로그인 계정 템플릿은 테스트 전용 {@code test-chatgpt}(src/test/resources/agent-templates — requires
 * [chatgpt]).
 */
@Transactional
class AgentReportedModelApiTest extends IntegrationTestBase {

  private static final String URL = "/api/v1/agent-runtime/me/models";
  private static final String MODELS =
      "\"models\":[{\"id\":\"gpt-6-luna\",\"label\":\"GPT-6-Luna\","
          + "\"efforts\":[\"low\",\"medium\",\"high\"]},{\"id\":\"gpt-6-sol\"}]";

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper om;
  @Autowired DSLContext dsl;
  @Autowired AgentLocationService locationService;
  @Autowired AgentRuntimeSettingService settingService;
  @Autowired AgentApiKeyService keyService;
  @Autowired AiAgentCredentialService credentials;

  private long admin;
  private long agent;
  private long credId;
  private String key;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createHuman(dsl));
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    locationService.create(admin, new CreateAgentLocationRequest("L1", null, 5));
    agent = newAgentOn("test-chatgpt");
    credId = registerChatgpt(agent, "a@example.test");
    key = keyService.issueManaged(agent, 1L, null, null, "L1").plaintext();
  }

  private long newAgentOn(String template) {
    TenantContext.set(1L);
    long id = TestFixtures.activeMemberOfCurrentTenant(dsl, TestFixtures.createAgentNoToken(dsl));
    settingService.put(
        admin, id, new PutAgentRuntimeSettingRequest(template, null, Map.of(), null));
    return id;
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

  /** 로그인 계정을 연결하고 연결 행 id(= Pod 의 GENIA_LOGIN_VERSION)를 돌려준다. */
  private long registerChatgpt(long agentId, String email) {
    return credentials.register(admin, agentId, "chatgpt", chatgptLogin(email), "codex", null).id();
  }

  /** 모델 목록 JSON 조각 앞에 loginVersion 을 붙인 보고 본문. */
  private static String withVersion(long version, String modelsJson) {
    return "{\"loginVersion\":" + version + "," + modelsJson + "}";
  }

  /** AI 키로 보고한다 — 호출 전후로 GUC 를 테넌트 1 로 맞춘다. */
  private ResultActions report(String akKey, String body) throws Exception {
    useTenant(1L);
    ResultActions r =
        mvc.perform(
            put(URL)
                .header("Authorization", "Bearer " + akKey)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body));
    useTenant(1L);
    return r;
  }

  /** 관리자 모델 목록 조회. */
  private ResultActions adminModels(long agentId) throws Exception {
    useTenant(1L);
    return mvc.perform(
        get("/api/v1/admin/agents/" + agentId + "/models")
            .with(
                authentication(
                    WebSessionAuth.of(admin, List.of(new SimpleGrantedAuthority("user:write"))))));
  }

  private int reportCount() {
    return dsl.fetchCount(AGENT_REPORTED_MODEL);
  }

  /** 보고하면 204 로 저장하고, 모델 목록 조회가 그 목록(이름 기본값·단계 대문자)을 돌려준다. */
  @Test
  void report_withLoginAccount_isReturnedByModelsLookup() throws Exception {
    report(key, withVersion(credId, MODELS)).andExpect(status().isNoContent());

    adminModels(agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("chatgpt"))
        .andExpect(jsonPath("$.models.length()").value(2))
        .andExpect(jsonPath("$.models[0].id").value("gpt-6-luna"))
        .andExpect(jsonPath("$.models[0].label").value("GPT-6-Luna"))
        .andExpect(jsonPath("$.models[0].efforts[0]").value("LOW"))
        .andExpect(jsonPath("$.models[0].efforts[2]").value("HIGH"))
        .andExpect(jsonPath("$.models[1].id").value("gpt-6-sol"))
        .andExpect(jsonPath("$.models[1].label").value("gpt-6-sol"));
  }

  /** 다시 보고하면 덮어쓴다 — 행은 하나. */
  @Test
  void report_twice_overwritesPreviousReport() throws Exception {
    report(key, withVersion(credId, MODELS)).andExpect(status().isNoContent());
    report(key, withVersion(credId, "\"models\":[{\"id\":\"gpt-7\",\"label\":\"GPT-7\"}]"))
        .andExpect(status().isNoContent());

    assertThat(reportCount()).isEqualTo(1);
    adminModels(agent)
        .andExpect(jsonPath("$.models.length()").value(1))
        .andExpect(jsonPath("$.models[0].id").value("gpt-7"));
  }

  /** 같은 id 가 거듭 오면 앞의 것만 남는다. */
  @Test
  void report_withDuplicateIds_keepsFirst() throws Exception {
    report(
            key,
            withVersion(
                credId,
                "\"models\":[{\"id\":\"m1\",\"label\":\"첫째\"},{\"id\":\"m1\",\"label\":\"둘째\"}]"))
        .andExpect(status().isNoContent());

    adminModels(agent)
        .andExpect(jsonPath("$.models.length()").value(1))
        .andExpect(jsonPath("$.models[0].label").value("첫째"));
  }

  /** 보고가 없으면 지금까지처럼 빈 목록. */
  @Test
  void modelsLookup_withoutReport_returnsEmptyList() throws Exception {
    adminModels(agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("chatgpt"))
        .andExpect(jsonPath("$.models.length()").value(0));
  }

  /** 연결을 다른 계정으로 바꾸면(새 연결 행) 옛 보고는 무시되고, 새 연결로 다시 보고하면 채워진다. */
  @Test
  void modelsLookup_afterCredentialReplaced_ignoresOldReportUntilRereported() throws Exception {
    report(key, withVersion(credId, MODELS)).andExpect(status().isNoContent());
    long newCred = registerChatgpt(agent, "b@example.test");

    adminModels(agent).andExpect(jsonPath("$.models.length()").value(0));

    report(key, withVersion(newCred, "\"models\":[{\"id\":\"gpt-8\"}]"))
        .andExpect(status().isNoContent());
    adminModels(agent)
        .andExpect(jsonPath("$.models.length()").value(1))
        .andExpect(jsonPath("$.models[0].id").value("gpt-8"));
  }

  /**
   * 옛 로그인의 Pod 가 늦게 보고하면(보고한 loginVersion 이 지금 활성 연결 id 가 아님) 저장 없이 204 로 무시한다 — 연결을 바꾼 새 행에 옛 계정의
   * 목록이 들어가지 않는다.
   */
  @Test
  void report_withStaleLoginVersion_isIgnoredWith204() throws Exception {
    long newCred = registerChatgpt(agent, "b@example.test");

    report(key, withVersion(credId, MODELS)).andExpect(status().isNoContent());
    assertThat(reportCount()).isZero();
    adminModels(agent).andExpect(jsonPath("$.models.length()").value(0));

    report(key, withVersion(newCred, MODELS)).andExpect(status().isNoContent());
    assertThat(reportCount()).isEqualTo(1);
    adminModels(agent).andExpect(jsonPath("$.models.length()").value(2));
  }

  /** 활성 연결이 로그인 계정이 아니면(Claude 구독) 저장 없이 204 로 무시한다. */
  @Test
  void report_whenActiveCredentialIsNotLogin_isIgnoredWith204() throws Exception {
    long claude = newAgentOn("claude-code");
    long claudeCred =
        credentials.register(admin, claude, "anthropic", "T".repeat(64), "main", null).id();
    String claudeKey = keyService.issueManaged(claude, 1L, null, null, "L1").plaintext();

    report(claudeKey, withVersion(claudeCred, MODELS)).andExpect(status().isNoContent());

    assertThat(reportCount()).isZero();
  }

  /** 연결이 아예 없는 AI 의 보고도 저장 없이 204. */
  @Test
  void report_withoutAnyCredential_isIgnoredWith204() throws Exception {
    long bare = newAgentOn("test-chatgpt");
    String bareKey = keyService.issueManaged(bare, 1L, null, null, "L1").plaintext();

    report(bareKey, withVersion(credId, MODELS)).andExpect(status().isNoContent());

    assertThat(reportCount()).isZero();
  }

  /** 사람은 보고할 수 없다 — 403 AGENT_ONLY. */
  @Test
  void report_fromHuman_returns403() throws Exception {
    TenantContext.set(1L);
    mvc.perform(
            put(URL)
                .contentType(MediaType.APPLICATION_JSON)
                .content(withVersion(credId, MODELS))
                .with(authentication(WebSessionAuth.of(admin, List.of()))))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.errors.code").value("AGENT_ONLY"));
  }

  /** 모델 id 꼴이 틀리거나(공백) models 가 없으면 400 이고 저장하지 않는다. */
  @Test
  void report_withInvalidBody_returns400() throws Exception {
    report(key, withVersion(credId, "\"models\":[{\"id\":\"bad id\"}]"))
        .andExpect(status().isBadRequest());
    report(key, withVersion(credId, "\"models\":[{\"id\":\"ok\",\"efforts\":[\"LOW\"]}]"))
        .andExpect(status().isBadRequest());
    report(key, "{\"loginVersion\":" + credId + "}").andExpect(status().isBadRequest());
    // loginVersion 이 없으면 어느 연결의 보고인지 몰라 400.
    report(key, "{" + MODELS + "}").andExpect(status().isBadRequest());

    assertThat(reportCount()).isZero();
  }

  /** 모델이 100개를 넘으면 400, 정확히 100개는 받는다. */
  @Test
  void report_withTooManyModels_returns400() throws Exception {
    report(key, bodyWithModels(101)).andExpect(status().isBadRequest());
    report(key, bodyWithModels(100)).andExpect(status().isNoContent());

    assertThat(reportCount()).isEqualTo(1);
  }

  private String bodyWithModels(int n) {
    StringBuilder sb = new StringBuilder("{\"loginVersion\":" + credId + ",\"models\":[");
    for (int i = 0; i < n; i++) {
      if (i > 0) sb.append(',');
      sb.append("{\"id\":\"m").append(i).append("\"}");
    }
    return sb.append("]}").toString();
  }
}
