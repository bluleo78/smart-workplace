package com.workplace.auth.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.AiAgentCredentialRow;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.RegisterAssistantCredentialRequest;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.exception.InvalidProviderCredentialException;
import com.workplace.auth.repository.AiAgentCredentialRepository;
import com.workplace.auth.repository.PersonalAssistantRepository;
import com.workplace.auth.service.AiAgentCredentialService;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-250 코드 리뷰: 등록 후 모델을 바꿔도 이미지 입력을 지정할 수 있다 — 비서 설정 변경(개인·공용)이 provider config 의 vision 만 그 자리에서
 * 고친다.
 *
 * <p>검증: 보낸 모델(없으면 지금 모델) 키 하나만 남기기, null 이면 자동으로 되돌리기, 보내지 않으면 그대로, 자격증명 행·apiKey·options 는 그대로,
 * 상태 응답의 vision 초깃값, Claude 연결·잘못된 값 거절.
 */
@Transactional
class AssistantVisionSettingsTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper om;
  @Autowired AiAgentCredentialService credentialService;
  @Autowired AiAgentCredentialRepository credentialRepo;
  @Autowired PersonalAssistantRepository personalRepo;
  @Autowired WorkspaceAssistantService workspaceService;

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

  /** opencode 로 개인 비서를 등록한 사용자 — 처음 모델 openai/gpt-4.1 에 이미지 입력 "볼 수 없음" 을 지정해 둔다. */
  private long humanWithOpencode() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    var config =
        new ProviderConfig(
            "openai",
            null,
            Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-secret-123"),
            Map.of("openai/gpt-4.1", false));
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    om.writeValueAsString(
                        new RegisterAssistantCredentialRequest(
                            "opencode", null, config, "openai/gpt-4.1", "opencode"))))
        .andExpect(status().isNoContent());
    return human;
  }

  private ResultActions putSettings(long human, String json) throws Exception {
    return mvc.perform(
        put("/api/v1/users/me/assistant/settings")
            .with(authentication(auth(human)))
            .contentType(MediaType.APPLICATION_JSON)
            .content(json));
  }

  private ResultActions statusOf(long human) throws Exception {
    return mvc.perform(get("/api/v1/users/me/assistant").with(authentication(auth(human))));
  }

  private long agentOf(long human) {
    return personalRepo.findAgentId(human).orElseThrow();
  }

  /** 저장된 provider config 평문(테스트 검증용). */
  private JsonNode payloadOf(long agentId) throws Exception {
    return om.readTree(credentialService.decryptActivePayload(agentId).payload());
  }

  @Test
  void 모델을_바꾸며_이미지_입력을_지정하면_새_모델_키_하나만_남고_자격증명_행과_비밀값은_그대로다() throws Exception {
    long human = humanWithOpencode();
    long agent = agentOf(human);
    AiAgentCredentialRow before = credentialRepo.findActive(agent).orElseThrow();
    statusOf(human).andExpect(jsonPath("$.vision").value(false));

    putSettings(human, "{\"model\":\"openai/my-custom-vl\",\"vision\":true}")
        .andExpect(status().isNoContent());

    statusOf(human)
        .andExpect(jsonPath("$.model").value("openai/my-custom-vl"))
        .andExpect(jsonPath("$.vision").value(true));
    JsonNode p = payloadOf(agent);
    assertThat(p.get("vision")).isEqualTo(om.readTree("{\"openai/my-custom-vl\":true}"));
    // 재등록이 아니라 같은 행을 고친다 — 비밀값·프로바이더 설정·행 id·라벨이 그대로다.
    assertThat(p.get("providerId").asText()).isEqualTo("openai");
    assertThat(p.get("options").get("apiKey").asText()).isEqualTo("sk-secret-123");
    assertThat(p.get("options").get("baseURL").asText()).isEqualTo("https://api.example.com/v1");
    AiAgentCredentialRow after = credentialRepo.findActive(agent).orElseThrow();
    assertThat(after.id()).isEqualTo(before.id());
    assertThat(after.label()).isEqualTo(before.label());
  }

  @Test
  void 모델_없이_이미지_입력만_보내면_지금_모델에_걸고_null_이면_자동으로_되돌린다() throws Exception {
    long human = humanWithOpencode();
    long agent = agentOf(human);

    putSettings(human, "{\"vision\":true}").andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.vision").value(true));
    assertThat(payloadOf(agent).get("vision")).isEqualTo(om.readTree("{\"openai/gpt-4.1\":true}"));

    putSettings(human, "{\"vision\":null}").andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.vision").doesNotExist());
    assertThat(payloadOf(agent).has("vision")).isFalse();
    assertThat(payloadOf(agent).get("options").get("apiKey").asText()).isEqualTo("sk-secret-123");
  }

  @Test
  void 이미지_입력을_보내지_않으면_지정은_그대로이고_모델만_바뀐_뒤엔_새_모델이_자동_감지로_보인다() throws Exception {
    long human = humanWithOpencode();
    long agent = agentOf(human);

    putSettings(human, "{\"thinkingDepth\":\"DEEP\"}").andExpect(status().isNoContent());
    assertThat(payloadOf(agent).get("vision")).isEqualTo(om.readTree("{\"openai/gpt-4.1\":false}"));

    // 보낸 필드만 바꾼다 — vision 키가 없으면 저장된 지정은 건드리지 않고, 새 모델에는 지정이 없어 상태는 자동(null)이다.
    putSettings(human, "{\"model\":\"openai/gpt-5\"}").andExpect(status().isNoContent());
    assertThat(payloadOf(agent).get("vision")).isEqualTo(om.readTree("{\"openai/gpt-4.1\":false}"));
    statusOf(human).andExpect(jsonPath("$.vision").doesNotExist());
  }

  @Test
  void 불리언이_아닌_값은_400_이고_저장된_지정은_바뀌지_않는다() throws Exception {
    long human = humanWithOpencode();
    putSettings(human, "{\"vision\":\"true\"}").andExpect(status().isBadRequest());
    putSettings(human, "{\"vision\":{\"openai/gpt-4.1\":true}}").andExpect(status().isBadRequest());
    assertThat(payloadOf(agentOf(human)).get("vision"))
        .isEqualTo(om.readTree("{\"openai/gpt-4.1\":false}"));
  }

  @Test
  void Claude_연결은_지정을_거절하고_자동_되돌리기는_아무_일도_하지_않는다() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(auth(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + "X".repeat(64) + "\",\"label\":\"t\"}"))
        .andExpect(status().isNoContent());

    putSettings(human, "{\"vision\":true}").andExpect(status().isBadRequest());
    putSettings(human, "{\"vision\":null}").andExpect(status().isNoContent());
    statusOf(human).andExpect(jsonPath("$.vision").doesNotExist());
  }

  @Test
  void 공용_비서도_모델을_바꾸며_이미지_입력을_지정할_수_있다() throws Exception {
    long admin = TestFixtures.createHuman(dsl);
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    credentialService.register(
        admin,
        agent,
        "opencode",
        "{\"providerId\":\"openai\",\"options\":{\"baseURL\":\"https://api.example.com/v1\",\"apiKey\":\"sk-ws\"}}",
        "ws",
        "openai/gpt-4.1");
    workspaceService.setAgent(admin, agent);
    assertThat(workspaceService.get().vision()).isNull();

    workspaceService.updateSettings(admin, req("{\"model\":\"openai/my-vl\",\"vision\":false}"));

    assertThat(workspaceService.get().model()).isEqualTo("openai/my-vl");
    assertThat(workspaceService.get().vision()).isFalse();
    assertThat(payloadOf(agent).get("vision")).isEqualTo(om.readTree("{\"openai/my-vl\":false}"));
    assertThat(payloadOf(agent).get("options").get("apiKey").asText()).isEqualTo("sk-ws");

    assertThatThrownBy(() -> workspaceService.updateSettings(admin, req("{\"vision\":1}")))
        .isInstanceOf(InvalidProviderCredentialException.class);
  }

  private UpdateAssistantSettingsRequest req(String json) throws Exception {
    return om.readValue(json, UpdateAssistantSettingsRequest.class);
  }
}
