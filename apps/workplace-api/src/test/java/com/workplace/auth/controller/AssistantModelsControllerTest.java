package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.AI_AGENT_CREDENTIAL;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
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
import com.workplace.agentaccount.dto.AgentAccountRequest;
import com.workplace.agentaccount.repository.AgentAccountRepository;
import com.workplace.agentaccount.service.AgentAccountService;
import com.workplace.agentruntime.dto.PutAgentRuntimeSettingRequest;
import com.workplace.agentruntime.service.AgentRuntimeSettingService;
import com.workplace.auth.dto.ActiveCredentialRef;
import com.workplace.auth.dto.ModelOption;
import com.workplace.auth.dto.ProbeModelsRequest;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.RegisterAssistantCredentialRequest;
import com.workplace.auth.exception.AssistantModelsProbeException;
import com.workplace.auth.outbound.AiAgentModelsClient;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AgentReportedModelService;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.AiAgentCredentialService.ActiveProviderSecret;
import com.workplace.auth.service.PodAccountSource;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.ExternalClientMockedTestBase;
import com.workplace.support.WebSessionAuth;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.assertj.core.api.Assertions;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/** Task10 — 모델 목록/프로브 API 통합 테스트. ai-agent 호출은 AiAgentModelsClient @MockitoBean 으로 대체. */
@Transactional
class AssistantModelsControllerTest extends ExternalClientMockedTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;
  @Autowired AiAgentCredentialRepository credentialRepository;
  @Autowired PersonalAssistantRepository personalAssistantRepository;
  @Autowired AgentAccountRepository accounts;
  @Autowired AgentAccountService accountService;
  @Autowired AgentReportedModelService reportedModels;
  @Autowired AiAgentCredentialService credentials;
  @Autowired AgentRuntimeSettingService settingService;

  @MockitoBean PodAccountSource podAccountSource;

  @Autowired AiAgentModelsClient modelsClient;

  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
    // 기본은 ‘묶인 계정 없음’(옛 경로) — 묶음이 나오는 테스트만 덧쓴다.
    org.mockito.Mockito.when(podAccountSource.findBoundRefs(any())).thenReturn(Map.of());
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private Authentication authWith(Long userId, String... permissions) {
    var authorities = Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList();
    return WebSessionAuth.of(userId, authorities);
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
            "openai", null, Map.of("baseURL", "http://api.openai.com/v1", "apiKey", "sk-xxxx"));
    var req = new ProbeModelsRequest(config);

    mvc.perform(
            post("/api/v1/users/me/assistant/models/probe")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isBadRequest());
  }

  @Test // WP-596: https 여도 메타데이터·루프백·사설망 주소면 ai-agent 를 부르지 않고 400 (SSRF)
  void 등록전_프로브_내부망_https는_400_ai_agent_미호출() throws Exception {
    Long human = createHumanUserForTest("USER");
    for (String url :
        new String[] {
          "https://169.254.169.254/latest/meta-data",
          "https://127.0.0.1:6060/v1",
          "https://10.0.0.5/v1"
        }) {
      var req =
          new ProbeModelsRequest(
              new ProviderConfig("openai", null, Map.of("baseURL", url, "apiKey", "sk-xxxx")));
      mvc.perform(
              post("/api/v1/users/me/assistant/models/probe")
                  .with(authentication(authWith(human)))
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(objectMapper.writeValueAsString(req)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("내부망 주소로는 모델 서버에 접속할 수 없습니다."));
    }
    verifyNoInteractions(modelsClient);
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
    var creReq = new RegisterAssistantCredentialRequest(null, token, null, null, "내 토큰", null);
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
    when(modelsClient.listAnthropicModels(token, null))
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
    verify(modelsClient).listAnthropicModels(token, null);
  }

  @Test // WP-1496: 사용자 API 키(sk-ant-usr) 연결은 저장된 워크스페이스 ID 를 함께 넘겨 조회한다
  void 개인비서_사용자API키_모델목록_워크스페이스ID_전달() throws Exception {
    Long human = createHumanUserForTest("USER");
    String token = "sk-ant-usr01-" + "X".repeat(40);
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        Map.of("token", token, "workspaceId", "wrkspc_models"))))
        .andExpect(status().isNoContent());
    when(modelsClient.listAnthropicModels(token, "wrkspc_models"))
        .thenReturn(List.of(new ModelOption("claude-opus-5-5", "Claude Opus 5.5")));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        // 맨 앞은 저장된 기본 모델(목록에 없어 덧붙임), 그다음이 실시간 조회 결과.
        .andExpect(jsonPath("$.models[1].id").value("claude-opus-5-5"));
    verify(modelsClient).listAnthropicModels(token, "wrkspc_models");
  }

  @Test // WP-1496: 묶인 계정의 워크스페이스 ID 도 모델 조회에 실린다
  void 관리자_AGENT_묶인_사용자API키_계정_워크스페이스ID_전달() throws Exception {
    Long admin = createHumanUserForTest("ADMIN");
    Long agent = createAgentUserWithMembership("models-usr-account");
    String token = "sk-ant-usr01-" + "A".repeat(40);
    when(podAccountSource.findBoundRefs(List.of(agent)))
        .thenReturn(
            Map.of(
                agent,
                new PodAccountSource.BoundRef(new ActiveCredentialRef(7L, "anthropic"), 1L)));
    when(podAccountSource.findBoundSecret(agent))
        .thenReturn(Optional.of(new ActiveProviderSecret(7L, "anthropic", token, "wrkspc_bound")));
    when(modelsClient.listAnthropicModels(token, "wrkspc_bound"))
        .thenReturn(List.of(new ModelOption("claude-sonnet-5-5", "Claude Sonnet 5.5")));

    adminModels(admin, agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models[0].id").value("claude-sonnet-5-5"));
    verify(modelsClient).listAnthropicModels(token, "wrkspc_bound");
  }

  @Test // #873: 실시간 조회 실패는 502 가 아니라 정적 목록 폴백(드롭다운이 비어 설정이 막히지 않게)
  void 개인비서_anthropic_실시간조회_실패시_정적목록_폴백() throws Exception {
    Long human = createHumanUserForTest("USER");
    registerMyAnthropic(human, "X".repeat(64));
    when(modelsClient.listAnthropicModels(any(), any()))
        .thenThrow(new AssistantModelsProbeException("down"));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.models[0].id").value("claude-sonnet-5-5"))
        // WP-139: 정적 목록에 Haiku 5.5 가 더해져 5개.
        .andExpect(jsonPath("$.models.length()").value(5));
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
    // 모델 조회는 하지 않는다 — 등록 때의 키 확인(WP-1496)은 별개라 목록 조회만 본다.
    verify(modelsClient, never()).listAnthropicModels(any(), any());
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
    when(modelsClient.listAnthropicModels(any(), any()))
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
    Long agent = createAgentUserWithMembership("models-agent");
    String token = "sk-ant-oat01-" + "Y".repeat(64);
    mvc.perform(
            post("/api/v1/admin/agents/" + agent + "/provider-credential")
                .with(authentication(authWith(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\",\"label\":\"t\"}"))
        .andExpect(status().isCreated());
    when(modelsClient.listAnthropicModels(token, null))
        .thenReturn(List.of(new ModelOption("claude-opus-5-5", "Claude Opus 5.5")));

    // 요청 필터 체인이 끝나면 TenantContext 가 비워진다 — 관리자 경로의 구성원 검사(WP-703)가 테넌트를 보므로 다시 맞춘다.
    TenantContext.set(1L);
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
        new RegisterAssistantCredentialRequest(
            "opencode", null, config, "gpt-4.1", "opencode", null);
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(creReq)))
        .andExpect(status().isNoContent());

    when(modelsClient.probeModels(any(), eq(true)))
        .thenReturn(List.of(new ModelOption("openai.gpt-oss-120b-1:0", "openai.gpt-oss-120b-1:0")));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("opencode"))
        // 저장된 모델("gpt-4.1")은 프로브 목록에 없어 맨 앞에 유지(#873), 프로브 결과는 providerId/ 접두
        .andExpect(jsonPath("$.models[0].id").value("gpt-4.1"))
        .andExpect(jsonPath("$.models[1].id").value("bedrock/openai.gpt-oss-120b-1:0"));
    verify(modelsClient).probeModels(any(), eq(true));
  }

  @Test // WP-1322: 모델별 생각의 깊이 단계(efforts)를 그대로 싣는다 — Claude 실시간 조회
  void 개인비서_anthropic_efforts_전달() throws Exception {
    Long human = createHumanUserForTest("USER");
    registerMyAnthropic(human, "X".repeat(64));
    when(modelsClient.listAnthropicModels(any(), any()))
        .thenReturn(
            List.of(
                new ModelOption(
                    "claude-sonnet-5-5",
                    "Claude Sonnet 5.5",
                    List.of("LOW", "MEDIUM", "HIGH", "XHIGH", "MAX"))));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models[0].efforts.length()").value(5))
        .andExpect(jsonPath("$.models[0].efforts[4]").value("MAX"));
  }

  @Test // WP-1322: 정적 폴백 목록은 단계를 모른다(null) — 웹이 Claude 기본(LOW~HIGH)으로 보인다
  void 개인비서_anthropic_정적폴백_efforts_null() throws Exception {
    Long human = createHumanUserForTest("USER");
    registerMyAnthropic(human, "X".repeat(64));
    when(modelsClient.listAnthropicModels(any(), any()))
        .thenThrow(new AssistantModelsProbeException("down"));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models[0].efforts").doesNotExist());
  }

  @Test // WP-1322: opencode 도 providerId/ 접두를 붙이면서 efforts(variant)를 버리지 않는다 — 등록 후 목록·등록 전 프로브 모두
  void opencode_efforts_접두와_함께_전달_등록전_프로브는_단계를_묻지_않는다() throws Exception {
    Long human = createHumanUserForTest("USER");
    var config =
        new ProviderConfig(
            "bedrock", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        new RegisterAssistantCredentialRequest(
                            "opencode", null, config, "bedrock/gpt-5", "opencode", null))))
        .andExpect(status().isNoContent());
    when(modelsClient.probeModels(any(), eq(true)))
        .thenReturn(List.of(new ModelOption("gpt-5", "gpt-5", List.of("LOW", "MEDIUM", "HIGH"))));
    when(modelsClient.probeModels(any())).thenReturn(List.of(new ModelOption("gpt-5", "gpt-5")));

    mvc.perform(get("/api/v1/users/me/assistant/models").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models[0].id").value("bedrock/gpt-5"))
        .andExpect(jsonPath("$.models[0].efforts[2]").value("HIGH"));

    // 등록 전 프로브는 단계를 묻지 않는다(빠르게 — withEfforts 없는 1인자 경로).
    mvc.perform(
            post("/api/v1/users/me/assistant/models/probe")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(new ProbeModelsRequest(config))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models[0].efforts").doesNotExist());
    verify(modelsClient).probeModels(any());
    verify(modelsClient).probeModels(any(), eq(true));
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
        new RegisterAssistantCredentialRequest(
            "opencode", null, config, "gpt-4.1", "opencode", null);
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(creReq)))
        .andExpect(status().isNoContent());

    when(modelsClient.probeModels(any(), eq(true)))
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
            "bedrock", null, Map.of("baseURL", "http://api.openai.com/v1", "apiKey", "sk-xxxx"));
    var creReq =
        new RegisterAssistantCredentialRequest(
            "opencode", null, config, "gpt-4.1", "opencode", null);

    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(creReq)))
        .andExpect(status().isBadRequest());
  }

  // ── WP-1458: 모델 목록이 묶인 계정을 먼저 본다 ───────────────────────────────────────────────

  @Test // 묶인 계정만 있고 옛 연결이 없으면 계정 목록이 보인다(옛 코드라면 옛 연결 없음 = 404).
  void 관리자_AGENT_옛연결없이_묶인계정만_있으면_계정_모델목록() throws Exception {
    Long admin = createHumanUserForTest("ADMIN");
    Long agent = createAgentUserWithMembership("models-account-only");
    String token = "A".repeat(64);
    long account =
        accountService
            .register(admin, new AgentAccountRequest("anthropic", token, null, "팀 구독", null, null))
            .id();
    long secretVersion = accounts.findActive(account).orElseThrow().secretVersion();
    // 묶음 참조는 실재하는 계정을 가리키고, 원문은 복호화된 것처럼 넘긴다(조회 방향만 본다).
    when(podAccountSource.findBoundRefs(List.of(agent)))
        .thenReturn(
            Map.of(
                agent,
                new PodAccountSource.BoundRef(
                    new ActiveCredentialRef(secretVersion, "anthropic"), 1L)));
    when(podAccountSource.findBoundSecret(agent))
        .thenReturn(Optional.of(new ActiveProviderSecret(secretVersion, "anthropic", token, null)));
    when(modelsClient.listAnthropicModels(eq(token), isNull()))
        .thenReturn(List.of(new ModelOption("claude-sonnet-5-5", "Claude Sonnet 5.5")));

    adminModels(admin, agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.models[0].id").value("claude-sonnet-5-5"));
    verify(modelsClient).listAnthropicModels(eq(token), isNull());
  }

  @Test // 옛 연결과 계정이 둘 다 있으면 계정이 이긴다.
  void 관리자_AGENT_묶인계정_있으면_옛연결_대신_쓴다() throws Exception {
    Long admin = createHumanUserForTest("ADMIN");
    Long agent = createAgentUserWithMembership("models-account-wins");
    String accountToken = "A".repeat(64);
    String credentialToken = "B".repeat(64);
    long account =
        accountService
            .register(
                admin, new AgentAccountRequest("anthropic", accountToken, null, "팀 구독", null, null))
            .id();
    long secretVersion = accounts.findActive(account).orElseThrow().secretVersion();
    when(podAccountSource.findBoundRefs(List.of(agent)))
        .thenReturn(
            Map.of(
                agent,
                new PodAccountSource.BoundRef(
                    new ActiveCredentialRef(secretVersion, "anthropic"), 1L)));
    when(podAccountSource.findBoundSecret(agent))
        .thenReturn(
            Optional.of(new ActiveProviderSecret(secretVersion, "anthropic", accountToken, null)));
    mvc.perform(
            post("/api/v1/admin/agents/" + agent + "/provider-credential")
                .with(authentication(authWith(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    objectMapper.writeValueAsString(
                        Map.of("token", credentialToken, "label", "t"))))
        .andExpect(status().isCreated());
    when(modelsClient.listAnthropicModels(eq(accountToken), isNull()))
        .thenReturn(List.of(new ModelOption("claude-account", "Account")));
    when(modelsClient.listAnthropicModels(eq(credentialToken), isNull()))
        .thenReturn(List.of(new ModelOption("claude-legacy", "Legacy")));

    adminModels(admin, agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.models.length()").value(1))
        .andExpect(jsonPath("$.models[0].id").value("claude-account"));
    verify(modelsClient).listAnthropicModels(eq(accountToken), isNull());
    verify(modelsClient, never()).listAnthropicModels(eq(credentialToken), any());
  }

  @Test // 묶인 로그인 계정(genia·chatgpt)도 보고분을 그대로 돌려준다 — 보고 종목 검증은 로그인 연결 버전 기준(옛 버전은 무시).
  void 관리자_AGENT_묶인_채팅GPT계정_보고목록_반환() throws Exception {
    Long admin = createHumanUserForTest("ADMIN");
    Long agent = createAgentUserWithMembership("models-chatgpt-account");
    TenantContext.set(1L);
    // 로그인 계정은 계정 종류만 맞으면 되는 게 아니라 그 실행 방식의 AI — 테스트 전용 템플릿으로 고정한다.
    settingService.put(
        admin, agent, new PutAgentRuntimeSettingRequest("test-chatgpt", null, Map.of(), null));
    long credentialId =
        credentials
            .register(admin, agent, "chatgpt", chatgptLogin("a@example.test"), "codex", null)
            .id();
    // 묶음 참조는 계정 버전을 쓰지만, 보고 저장·사용은 로그인 연결 버전 기준이라 실제 연결 행과 맞춘다.
    when(podAccountSource.findBoundRefs(List.of(agent)))
        .thenReturn(
            Map.of(
                agent,
                new PodAccountSource.BoundRef(
                    new ActiveCredentialRef(credentialId, "chatgpt"), 2L)));
    reportedModels.report(
        agent, credentialId, List.of(new ModelOption("gpt-6-luna", "GPT-6-Luna")));
    reportedModels.report(
        agent, credentialId + 1000, List.of(new ModelOption("gpt-stale", "Stale")));

    adminModels(admin, agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("chatgpt"))
        .andExpect(jsonPath("$.models.length()").value(1))
        .andExpect(jsonPath("$.models[0].id").value("gpt-6-luna"));
  }

  @Test // 묶인 OpenAI 호환 계정은 그 계정의 연결 설정으로 조회한다(providerId 접두 유지).
  void 관리자_AGENT_묶인_OpenAI호환계정_그것의_설정으로_프로브() throws Exception {
    Long admin = createHumanUserForTest("ADMIN");
    Long agent = createAgentUserWithMembership("models-opencode-account");
    long account = registerOpencodeAccount(admin, "myhost", "https://api.example.com/v1");
    long secretVersion = accounts.findActive(account).orElseThrow().secretVersion();
    when(podAccountSource.findBoundRefs(List.of(agent)))
        .thenReturn(
            Map.of(
                agent,
                new PodAccountSource.BoundRef(
                    new ActiveCredentialRef(secretVersion, "opencode"), 1L)));
    when(podAccountSource.findBoundSecret(agent))
        .thenReturn(
            Optional.of(
                new ActiveProviderSecret(
                    secretVersion,
                    "opencode",
                    "{\"providerId\":\"myhost\",\"options\":{\"baseURL\":\"https://api.example.com/v1\",\"apiKey\":\"sk-account\"}}",
                    null)));
    ArgumentCaptor<ProviderConfig> probe = ArgumentCaptor.forClass(ProviderConfig.class);
    when(modelsClient.probeModels(probe.capture(), eq(true)))
        .thenReturn(List.of(new ModelOption("m1", "M1")));

    adminModels(admin, agent)
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.provider").value("opencode"))
        .andExpect(jsonPath("$.models[0].id").value("myhost/m1"));
    Assertions.assertThat(probe.getValue().providerId()).isEqualTo("myhost");
    Assertions.assertThat(probe.getValue().options().get("baseURL"))
        .isEqualTo("https://api.example.com/v1");
  }

  @Test // 묶음 참조와 계정 조회 사이의 경합(그 사이 해제·폐기)으로 원문이 사라지면 500 대신 옛 경로 계약(옛 연결 없음 = 404)이 된다.
  void 관리자_AGENT_묶인계정_조회경합_원문없음_500아님() throws Exception {
    Long admin = createHumanUserForTest("ADMIN");
    Long agent = createAgentUserWithMembership("models-race-empty");
    when(podAccountSource.findBoundRefs(List.of(agent)))
        .thenReturn(
            Map.of(
                agent,
                new PodAccountSource.BoundRef(new ActiveCredentialRef(3L, "anthropic"), 1L)));
    when(podAccountSource.findBoundSecret(agent)).thenReturn(Optional.empty());

    adminModels(admin, agent).andExpect(status().isNotFound());
    verifyNoInteractions(modelsClient);
  }

  private ResultActions adminModels(Long admin, Long agent) throws Exception {
    TenantContext.set(1L);
    ResultActions r =
        mvc.perform(
            get("/api/v1/admin/agents/" + agent + "/models")
                .with(authentication(authWith(admin, "user:write"))));
    TenantContext.set(1L);
    return r;
  }

  /** 가짜 OpenAI 호환 계정 원문(providerConfig JSON). */
  private long registerOpencodeAccount(Long admin, String providerId, String baseUrl) {
    var config =
        new ProviderConfig(providerId, null, Map.of("baseURL", baseUrl, "apiKey", "sk-account"));
    return accountService
        .register(admin, new AgentAccountRequest("opencode", null, config, "팀 호환", null, null))
        .id();
  }

  /** 가짜 ChatGPT 로그인 정보(auth.json 모양). */
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
