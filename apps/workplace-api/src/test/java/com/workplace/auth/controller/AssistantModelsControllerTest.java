package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.ProbeModelsRequest;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.RegisterAssistantCredentialRequest;
import com.workplace.auth.exception.AssistantModelsProbeException;
import com.workplace.auth.outbound.AiAgentModelsClient;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** Task10 — 모델 목록/프로브 API 통합 테스트. ai-agent 호출은 AiAgentModelsClient @MockitoBean 으로 대체. */
@AutoConfigureMockMvc
@Transactional
class AssistantModelsControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @Autowired AiAgentCredentialRepository credentialRepository;
  @Autowired PersonalAssistantRepository personalAssistantRepository;

  @MockitoBean AiAgentModelsClient modelsClient;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private Authentication authWith(Long userId, String... permissions) {
    var authorities = Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList();
    return new UsernamePasswordAuthenticationToken(userId, "n/a", authorities);
  }

  @Test
  void 등록전_프로브_정상_200_providerId_접두() throws Exception {
    // 등록 후 목록 조회(resolveAgentModels)와 동일하게 providerId/ 접두 — 실측 버그 회귀 방지:
    // 접두 누락 시 프론트가 raw id 를 그대로 assistant_config.model 에 저장해 실행 시점 splitOpencodeModel 실패.
    Long human = createHumanUserForTest("USER");
    when(modelsClient.probeModels(any()))
        .thenReturn(List.of(new ModelOption("model-a", "model-a")));

    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req = new ProbeModelsRequest(config);

    mvc.perform(
            post("/api/v1/users/me/assistant/models/probe")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models[0].id").value("openai/model-a"))
        .andExpect(jsonPath("$.models[0].label").value("openai/model-a"));
  }

  @Test
  void 등록전_프로브_apiKey_누락시_400() throws Exception {
    Long human = createHumanUserForTest("USER");
    var config =
        new ProviderConfig("openai", null, Map.of("baseURL", "https://api.example.com/v1"));
    var req = new ProbeModelsRequest(config);

    mvc.perform(
            post("/api/v1/users/me/assistant/models/probe")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 등록전_프로브_공인호스트_http는_400_SSRF가드() throws Exception {
    Long human = createHumanUserForTest("USER");
    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "http://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req = new ProbeModelsRequest(config);

    mvc.perform(
            post("/api/v1/users/me/assistant/models/probe")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void 등록전_프로브_ai_agent_실패시_502() throws Exception {
    Long human = createHumanUserForTest("USER");
    when(modelsClient.probeModels(any()))
        .thenThrow(new AssistantModelsProbeException("모델 목록 조회에 실패했습니다."));

    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req = new ProbeModelsRequest(config);

    mvc.perform(
            post("/api/v1/users/me/assistant/models/probe")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isBadGateway());
  }

  @Test
  void 관리자_프로브_user_write_권한없으면_403() throws Exception {
    Long human = createHumanUserForTest("USER"); // USER 역할 = user:write 없음(가정)
    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req = new ProbeModelsRequest(config);

    mvc.perform(
            post("/api/v1/admin/agents/models/probe")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isForbidden());
  }

  /** 개인 비서 anthropic 자격증명 등록(구독 토큰). 등록 시 model 은 기본값(AssistantDefaults.MODEL)으로 채워진다. */
  private void registerMyAnthropic(Long human, String token) throws Exception {
    var creReq = new RegisterAssistantCredentialRequest(null, token, null, null, "내 토큰");
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(creReq)))
        .andExpect(status().isNoContent());
  }

  @Test // #873: anthropic 은 저장된 토큰으로 실시간 조회 — 응답 순서(최신순)·display_name 라벨 그대로
  void 개인비서_anthropic_모델목록_실시간조회_결과반환() throws Exception {
    Long human = createHumanUserForTest("USER");
    String token = "sk-ant-oat01-" + "X".repeat(64);
    registerMyAnthropic(human, token);
    when(modelsClient.listAnthropicModels(token))
        .thenReturn(
            List.of(
                new ModelOption("claude-sonnet-5-5", "Claude Sonnet 5.5"),
                new ModelOption("claude-opus-5-5", "Claude Opus 5.5")));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.models.length()").value(2))
        .andExpect(jsonPath("$.models[0].id").value("claude-sonnet-5-5"))
        .andExpect(jsonPath("$.models[0].label").value("Claude Sonnet 5.5"));
    verify(modelsClient).listAnthropicModels(token);
  }

  @Test // #873: 실시간 조회 실패는 502 가 아니라 정적 목록 폴백(드롭다운이 비어 설정이 막히지 않게)
  void 개인비서_anthropic_실시간조회_실패시_정적목록_폴백() throws Exception {
    Long human = createHumanUserForTest("USER");
    registerMyAnthropic(human, "X".repeat(64));
    when(modelsClient.listAnthropicModels(any()))
        .thenThrow(new AssistantModelsProbeException("down"));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.models[0].id").value("claude-sonnet-5-5"))
        .andExpect(jsonPath("$.models.length()").value(4));
  }

  @Test // #873: 토큰 복호화 실패(키 교체·손상 행)도 500 이 아니라 정적 목록 폴백
  void 개인비서_anthropic_토큰복호화_실패시_정적목록_폴백() throws Exception {
    Long human = createHumanUserForTest("USER");
    registerMyAnthropic(human, "X".repeat(64));
    Long agentId = personalAssistantRepository.findAgentId(human).orElseThrow();
    dsl.update(AI_AGENT_CREDENTIAL)
        .set(AI_AGENT_CREDENTIAL.ENCRYPTED_TOKEN, "AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA")
        .where(AI_AGENT_CREDENTIAL.USER_ID.eq(agentId))
        .execute();

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models[0].id").value("claude-sonnet-5-5"));
    verifyNoInteractions(modelsClient);
  }

  @Test // #873: 저장된 모델(별칭 등)이 목록에 없으면 맨 앞에 덧붙여 드롭다운이 현재값을 빈칸으로 표시하지 않게
  void 개인비서_anthropic_저장모델이_목록에없으면_앞에_포함() throws Exception {
    Long human = createHumanUserForTest("USER");
    registerMyAnthropic(human, "X".repeat(64));
    mvc.perform(
            put("/api/v1/users/me/assistant/settings")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"model\":\"claude-haiku-4-5\"}"))
        .andExpect(status().is2xxSuccessful());
    when(modelsClient.listAnthropicModels(any()))
        .thenReturn(List.of(new ModelOption("claude-haiku-4-5-20251001", "Claude Haiku 4.5")));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models.length()").value(2))
        .andExpect(jsonPath("$.models[0].id").value("claude-haiku-4-5"))
        .andExpect(jsonPath("$.models[1].id").value("claude-haiku-4-5-20251001"));
  }

  @Test // #873: 관리자 AGENT 모델 목록도 anthropic 이면 실시간 조회
  void 관리자_AGENT_anthropic_모델목록_실시간조회() throws Exception {
    Long admin = createHumanUserForTest("ADMIN");
    Long agent = createAgentUser("models-agent");
    String token = "sk-ant-oat01-" + "Y".repeat(64);
    mvc.perform(
            post("/api/v1/admin/agents/" + agent + "/provider-credential")
                .with(authentication(authWith(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\",\"label\":\"t\"}"))
        .andExpect(status().isCreated());
    when(modelsClient.listAnthropicModels(token))
        .thenReturn(List.of(new ModelOption("claude-opus-5-5", "Claude Opus 5.5")));

    mvc.perform(
            get("/api/v1/admin/agents/" + agent + "/models")
                .with(authentication(authWith(admin, "user:write"))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.models[?(@.id=='claude-opus-5-5')].label").value("Claude Opus 5.5"));
  }

  @Test
  void 개인비서_opencode_모델목록_프로브결과에_providerId_접두() throws Exception {
    Long human = createHumanUserForTest("USER");
    var config =
        new ProviderConfig(
            "bedrock", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var creReq =
        new RegisterAssistantCredentialRequest("opencode", null, config, "gpt-4.1", "opencode");
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(creReq)))
        .andExpect(status().isNoContent());

    when(modelsClient.probeModels(any()))
        .thenReturn(List.of(new ModelOption("openai.gpt-oss-120b-1:0", "openai.gpt-oss-120b-1:0")));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("opencode"))
        // 저장된 모델("gpt-4.1")은 프로브 목록에 없어 맨 앞에 유지(#873), 프로브 결과는 providerId/ 접두
        .andExpect(jsonPath("$.models[0].id").value("gpt-4.1"))
        .andExpect(jsonPath("$.models[1].id").value("bedrock/openai.gpt-oss-120b-1:0"));
    verify(modelsClient).probeModels(any());
  }

  @Test
  void 개인비서_미설정_모델목록_조회시_409() throws Exception {
    Long human = createHumanUserForTest("USER");
    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isConflict());
  }

  @Test // 모델 목록 GET(드롭다운 오픈 등 단순 조회)이 last_used_at 을 갱신하면 안 됨 — 실제 LLM 호출과 구분
  void 개인비서_opencode_모델목록_조회는_lastUsedAt을_갱신하지_않음() throws Exception {
    Long human = createHumanUserForTest("USER");
    var config =
        new ProviderConfig(
            "bedrock", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var creReq =
        new RegisterAssistantCredentialRequest("opencode", null, config, "gpt-4.1", "opencode");
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(creReq)))
        .andExpect(status().isNoContent());

    when(modelsClient.probeModels(any()))
        .thenReturn(List.of(new ModelOption("openai.gpt-oss-120b-1:0", "openai.gpt-oss-120b-1:0")));

    Long agentId = personalAssistantRepository.findAgentId(human).orElseThrow();
    org.assertj.core.api.Assertions.assertThat(
            credentialRepository.findActive(agentId).get().lastUsedAt())
        .isNull();

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk());
    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk());

    org.assertj.core.api.Assertions.assertThat(
            credentialRepository.findActive(agentId).get().lastUsedAt())
        .isNull();
  }

  @Test // 등록시점 SSRF 가드: opencode 자격증명 등록 baseURL 이 공인호스트 http 면 registration 자체가 400
  void 개인비서_opencode_등록시_공인호스트_http는_400() throws Exception {
    Long human = createHumanUserForTest("USER");
    var config =
        new ProviderConfig(
            "bedrock", null, Map.of("baseURL", "http://api.example.com/v1", "apiKey", "sk-xxxx"));
    var creReq =
        new RegisterAssistantCredentialRequest("opencode", null, config, "gpt-4.1", "opencode");

    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(creReq)))
        .andExpect(status().isBadRequest());
  }

  private Long createHumanUserForTest(String roleName) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "human-" + suffix)
            .set(USER.NAME, "human")
            .set(USER.EMAIL, "human-" + suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    dsl.update(USER).set(USER.PASSWORD, "pw").where(USER.ID.eq(id)).execute();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }
}
