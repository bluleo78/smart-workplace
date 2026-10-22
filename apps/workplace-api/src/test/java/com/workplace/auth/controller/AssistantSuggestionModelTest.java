package com.workplace.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.RegisterAssistantCredentialRequest;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.dto.WorkspaceAssistantResponse;
import com.workplace.auth.service.AiAgentCredentialService;
import com.workplace.auth.service.AssistantModels;
import com.workplace.auth.service.AssistantResolver;
import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import java.util.Map;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-139: 비서 추천 모델 — 저장·조회 왕복(개인·공용), 부분 갱신(보내지 않은 필드 보존 — 모델만 바꾸면 생각의 깊이가 초기화되던 기존 버그 회귀), 자동 모델은
 * API 설정(workplace.ai.suggestion-default-model)이 정한다(상태 응답의 suggestionModelAuto·비서 사양의
 * suggestionModel), opencode 는 비서 모델, 정적 모델 목록. 기본값과 다른 값으로 설정을 덮어 설정이 실제로 쓰임을 확인한다.
 */
@Transactional
@TestPropertySource(properties = "workplace.ai.suggestion-default-model=claude-haiku-test")
class AssistantSuggestionModelTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired WorkspaceAssistantService workspaceService;
  @Autowired AssistantResolver resolver;
  @Autowired AiAgentCredentialService credentialService;

  /** 개인 비서 등록은 신규 AGENT 멤버십에 active 테넌트가 필요하다(MyAssistantControllerTest 와 같음). */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private Authentication auth(long userId) {
    return new UsernamePasswordAuthenticationToken(userId, "n/a", List.of());
  }

  /** anthropic 토큰으로 개인 비서를 등록한 사용자. */
  private long humanWithAssistant() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + "X".repeat(64) + "\",\"label\":\"t\"}"))
        .andExpect(status().isNoContent());
    return human;
  }

  /** opencode(모델 gpt-4.1) 로 개인 비서를 등록한 사용자 — MyAssistantControllerTest 의 opencode 등록과 같은 본문. */
  private long humanWithOpencodeAssistant() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    registerCredential(human, "opencode");
    return human;
  }

  /**
   * 기존 사용자의 개인 비서 자격증명을 (재)등록 — provider 는 "anthropic" 또는 "opencode"(providerId openai, 모델
   * gpt-4.1).
   */
  private void registerCredential(long human, String provider) throws Exception {
    registerCredential(human, provider, "openai");
  }

  /** (재)등록 — opencode 면 providerId 를 고른다(추천 모델 "providerId/model" 접두 판정 검증용). */
  private void registerCredential(long human, String provider, String providerId) throws Exception {
    String body;
    if ("opencode".equals(provider)) {
      var config =
          new ProviderConfig(
              providerId,
              null,
              Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
      body =
          om.writeValueAsString(
              new RegisterAssistantCredentialRequest(
                  "opencode", null, config, "gpt-4.1", "opencode"));
    } else {
      body = "{\"token\":\"" + "Y".repeat(64) + "\",\"label\":\"t2\"}";
    }
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().isNoContent());
  }

  private ResultActions putSettings(long human, String json) throws Exception {
    return mvc.perform(
        put("/api/v1/users/me/assistant/settings")
            .with(authentication(auth(human)))
            .contentType(MediaType.APPLICATION_JSON)
            .content(json));
  }

  /** 내 비서 상태 조회 — 이름이 status 면 정적 import status() 를 가린다. */
  private ResultActions statusOf(long human) throws Exception {
    return mvc.perform(get("/api/v1/users/me/assistant").with(authentication(auth(human))));
  }

  private UpdateAssistantSettingsRequest req(String json) throws Exception {
    return om.readValue(json, UpdateAssistantSettingsRequest.class);
  }

  @Test
  void 추천_모델을_저장하면_상태에_보이고_null_이면_자동으로_돌아간다() throws Exception {
    long human = humanWithAssistant();
    // 자동 — 원시값은 비어 있고, 자동일 때 쓸 모델은 API 설정값.
    statusOf(human)
        .andExpect(jsonPath("$.suggestionModel").doesNotExist())
        .andExpect(jsonPath("$.suggestionModelAuto").value("claude-haiku-test"));

    putSettings(human, "{\"suggestionModel\":\"claude-haiku-5-5\"}")
        .andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.suggestionModel").value("claude-haiku-5-5"));

    putSettings(human, "{\"suggestionModel\":null}").andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.suggestionModel").doesNotExist());
  }

  @Test
  void 개인_모델만_바꿔도_생각의_깊이와_추천_모델은_그대로다() throws Exception {
    long human = humanWithAssistant();
    putSettings(human, "{\"thinkingDepth\":\"DEEP\",\"suggestionModel\":\"claude-haiku-5-5\"}")
        .andExpect(status().isNoContent());
    // 기존 버그 회귀: 웹은 {model} 만 보낸다 — 예전에는 thinkingDepth 가 NULL(기본 NORMAL)로 지워졌다.
    putSettings(human, "{\"model\":\"claude-opus-5-5\"}").andExpect(status().isNoContent());

    statusOf(human)
        .andExpect(jsonPath("$.model").value("claude-opus-5-5"))
        .andExpect(jsonPath("$.thinkingDepth").value("DEEP"))
        .andExpect(jsonPath("$.suggestionModel").value("claude-haiku-5-5"));
  }

  @Test
  void 개인_생각의_깊이만_바꿔도_모델은_그대로다() throws Exception {
    long human = humanWithAssistant();
    putSettings(human, "{\"model\":\"claude-opus-5-5\"}").andExpect(status().isNoContent());
    putSettings(human, "{\"thinkingDepth\":\"DEEP\"}").andExpect(status().isNoContent());
    statusOf(human)
        .andExpect(jsonPath("$.model").value("claude-opus-5-5"))
        .andExpect(jsonPath("$.thinkingDepth").value("DEEP"));
  }

  @Test
  void 추천_모델은_64자를_넘으면_400() throws Exception {
    long human = humanWithAssistant();
    putSettings(human, "{\"suggestionModel\":\"" + "m".repeat(65) + "\"}")
        .andExpect(status().isBadRequest());
  }

  /**
   * WP-823: 비서 모델도 assistant_config.model 폭(64)을 넘으면 원인 모를 409(저장 실패) 대신 400 으로 어느 칸인지 알린다 — 추천 모델과
   * 같은 규칙. 64자는 그대로 저장된다.
   */
  @Test
  void 비서_모델도_64자를_넘으면_400_이고_64자는_저장된다() throws Exception {
    long human = humanWithAssistant();
    putSettings(human, "{\"model\":\"" + "m".repeat(65) + "\"}")
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.model").value("최대 64까지 입력할 수 있습니다"));
    putSettings(human, "{\"model\":\"" + "m".repeat(64) + "\"}").andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.model").value("m".repeat(64)));
  }

  /** WP-823: 자격증명 등록의 model 도 같은 칸(assistant_config.model)에 저장되므로 64자를 넘으면 400 이다. */
  @Test
  void 자격증명_등록의_모델도_64자를_넘으면_400() throws Exception {
    long human = humanWithAssistant();
    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        new RegisterAssistantCredentialRequest(
                            "opencode", null, config, "openai/" + "m".repeat(60), "opencode"))))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.model").value("최대 64까지 입력할 수 있습니다"));
  }

  @Test
  void 공용_비서_모델만_바꿔도_생각의_깊이와_추천_모델은_그대로다() throws Exception {
    long admin = TestFixtures.createHuman(dsl);
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    workspaceService.setAgent(admin, agent);

    workspaceService.updateSettings(
        admin, req("{\"thinkingDepth\":\"DEEP\",\"suggestionModel\":\"claude-haiku-5-5\"}"));
    // 기존 버그 회귀(관리자 화면도 {model} 만 보낸다).
    workspaceService.updateSettings(admin, req("{\"model\":\"claude-opus-5-5\"}"));

    WorkspaceAssistantResponse ws = workspaceService.get();
    assertThat(ws.model()).isEqualTo("claude-opus-5-5");
    assertThat(ws.thinkingDepth()).isEqualTo("DEEP");
    assertThat(ws.suggestionModel()).isEqualTo("claude-haiku-5-5");
    // 토큰이 없는 비서 — 자동으로 쓸 모델을 정할 연결이 없다.
    assertThat(ws.suggestionModelAuto()).isNull();

    workspaceService.updateSettings(admin, req("{\"thinkingDepth\":\"NONE\"}"));
    assertThat(workspaceService.get().model()).isEqualTo("claude-opus-5-5");
  }

  @Test
  void 공용_비서_자동_모델은_연결_제공자를_따른다() throws Exception {
    long admin = TestFixtures.createHuman(dsl);
    long agent = withMembership(TestFixtures.createAgentWithToken(dsl, credentialService, admin));
    workspaceService.setAgent(admin, agent);
    assertThat(workspaceService.get().suggestionModelAuto()).isEqualTo("claude-haiku-test");
  }

  @Test
  void Anthropic_비서_사양은_자동이면_설정_기본값_지정하면_그_값을_싣는다() throws Exception {
    long human = humanWithAssistant();
    assertThat(resolver.resolve(human).suggestionModel()).isEqualTo("claude-haiku-test");
    putSettings(human, "{\"suggestionModel\":\"claude-opus-5-5\"}")
        .andExpect(status().isNoContent());
    assertThat(resolver.resolve(human).suggestionModel()).isEqualTo("claude-opus-5-5");
  }

  @Test
  void opencode_자동은_모델을_싣지_않고_상태에는_비서_모델을_보인다() throws Exception {
    long human = humanWithOpencodeAssistant();
    // null — ai-agent 가 credential.model(비서 모델)을 쓴다.
    assertThat(resolver.resolve(human).suggestionModel()).isNull();
    statusOf(human).andExpect(jsonPath("$.suggestionModelAuto").value("gpt-4.1"));
  }

  @Test
  void 추천_모델의_앞뒤_공백은_걷고_공백뿐이면_자동으로_돌아간다() throws Exception {
    long human = humanWithAssistant();
    putSettings(human, "{\"suggestionModel\":\"  claude-haiku-5-5  \"}")
        .andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.suggestionModel").value("claude-haiku-5-5"));

    putSettings(human, "{\"suggestionModel\":\"   \"}").andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.suggestionModel").doesNotExist());
  }

  @Test
  void 다른_제공자로_재등록하면_추천_모델이_자동으로_돌아간다() throws Exception {
    // 실측 위험: Anthropic 용 추천 모델이 opencode 연결에 그대로 실리면 추천·후속이 조용히 전부 실패한다.
    long human = humanWithAssistant();
    putSettings(human, "{\"suggestionModel\":\"claude-haiku-5-5\"}")
        .andExpect(status().isNoContent());

    registerCredential(human, "opencode");

    statusOf(human)
        .andExpect(jsonPath("$.suggestionModel").doesNotExist())
        .andExpect(jsonPath("$.suggestionModelAuto").value("gpt-4.1"));
    // opencode 자동 — 모델을 싣지 않아 ai-agent 가 연결 모델을 쓴다.
    assertThat(resolver.resolve(human).suggestionModel()).isNull();
  }

  @Test
  void opencode_에서_Anthropic_으로_재등록해도_추천_모델이_자동으로_돌아간다() throws Exception {
    long human = humanWithOpencodeAssistant();
    putSettings(human, "{\"suggestionModel\":\"openai/gpt-4.1-mini\"}")
        .andExpect(status().isNoContent());

    registerCredential(human, "anthropic");

    statusOf(human)
        .andExpect(jsonPath("$.suggestionModel").doesNotExist())
        .andExpect(jsonPath("$.suggestionModelAuto").value("claude-haiku-test"));
    assertThat(resolver.resolve(human).suggestionModel()).isEqualTo("claude-haiku-test");
  }

  @Test
  void 같은_제공자로_토큰만_갱신하면_추천_모델을_지킨다() throws Exception {
    long human = humanWithAssistant();
    putSettings(human, "{\"suggestionModel\":\"claude-opus-5-5\"}")
        .andExpect(status().isNoContent());

    registerCredential(human, "anthropic");

    statusOf(human).andExpect(jsonPath("$.suggestionModel").value("claude-opus-5-5"));
  }

  @Test
  void opencode_를_다른_providerId_로_재등록하면_추천_모델이_자동으로_돌아간다() throws Exception {
    // provider 계열은 같아도 "openai/…" 는 새 연결(providerId other)에서 쓸 수 없는 모델이다 — 남기면 추천·후속이 조용히 빠진다.
    long human = humanWithOpencodeAssistant();
    putSettings(human, "{\"suggestionModel\":\"openai/gpt-4.1-mini\"}")
        .andExpect(status().isNoContent());

    registerCredential(human, "opencode", "other");

    statusOf(human).andExpect(jsonPath("$.suggestionModel").doesNotExist());
    assertThat(resolver.resolve(human).suggestionModel()).isNull();
  }

  @Test
  void opencode_를_같은_providerId_로_재등록하면_추천_모델을_지킨다() throws Exception {
    // API 키 교체처럼 같은 연결을 다시 등록하는 경우 — 사용자 선택을 지운다면 매번 다시 골라야 한다.
    long human = humanWithOpencodeAssistant();
    putSettings(human, "{\"suggestionModel\":\"openai/gpt-4.1-mini\"}")
        .andExpect(status().isNoContent());

    registerCredential(human, "opencode", "openai");

    statusOf(human).andExpect(jsonPath("$.suggestionModel").value("openai/gpt-4.1-mini"));
  }

  @Test
  void opencode_재등록_때_접두가_없는_추천_모델은_자동으로_돌아간다() throws Exception {
    // "providerId/" 접두가 없으면 어느 연결용인지 알 수 없다 — 새 연결에서 쓸 수 있다고 볼 근거가 없다.
    long human = humanWithOpencodeAssistant();
    putSettings(human, "{\"suggestionModel\":\"gpt-4.1-mini\"}").andExpect(status().isNoContent());

    registerCredential(human, "opencode", "openai");

    statusOf(human).andExpect(jsonPath("$.suggestionModel").doesNotExist());
  }

  @Test
  void Anthropic_정적_목록에_Haiku_5_5_가_있다() {
    assertThat(AssistantModels.ANTHROPIC).anyMatch(m -> m.id().equals("claude-haiku-5-5"));
  }
}
