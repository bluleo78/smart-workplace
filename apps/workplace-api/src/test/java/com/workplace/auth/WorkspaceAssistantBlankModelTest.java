package com.workplace.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.UpdateAssistantSettingsRequest;
import com.workplace.auth.service.AssistantDefaults;
import com.workplace.auth.service.PersonalAssistantService;
import com.workplace.auth.service.WorkspaceAssistantService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.WebSessionAuth;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-1395 — 비서 설정에 공백만 든 모델명을 보내면 " " 가 그대로 저장돼 기본 모델로 대체되지 않았다. 공백뿐이면 모델 없음(null)으로 저장해 기본 모델이
 * 쓰이고, 앞뒤 공백은 뗀다. 공용(HTTP)·개인(요청 JSON 역직렬화) 모두 같은 요청 DTO 를 쓴다.
 */
@Transactional
class WorkspaceAssistantBlankModelTest extends IntegrationTestBase {

  private static final String TOKEN = "sk-ant-oat-" + "x".repeat(40);

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired ObjectMapper objectMapper;
  @Autowired WorkspaceAssistantService workspaceService;
  @Autowired PersonalAssistantService personalService;

  private long admin;

  @BeforeEach
  void seed() {
    TenantContext.set(1L);
    admin = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, admin, "ADMIN");
    TestFixtures.addMember(dsl, admin, 1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private void putSharedSettings(String body) throws Exception {
    // 요청 필터 체인이 끝나면 TenantContext 가 비워지므로 호출마다 tenant#1 로 다시 맞춘다.
    TenantContext.set(1L);
    mvc.perform(
            put("/api/v1/admin/workspace-assistant/settings")
                .with(
                    authentication(
                        WebSessionAuth.of(
                            admin, List.of(new SimpleGrantedAuthority("user:write")))))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body))
        .andExpect(status().is2xxSuccessful());
  }

  private long designateSharedAssistant() {
    long agent = withMembership(TestFixtures.createAgentNoToken(dsl));
    workspaceService.setAgent(admin, agent);
    return agent;
  }

  @Test
  void 공용_비서_공백만_든_모델명은_기본_모델로_되돌린다() throws Exception {
    designateSharedAssistant();
    putSharedSettings("{\"model\":\"claude-x\"}");
    assertThat(workspaceService.get().model()).isEqualTo("claude-x");

    putSharedSettings("{\"model\":\"   \"}");
    assertThat(workspaceService.get().model()).isEqualTo(AssistantDefaults.MODEL);

    putSharedSettings("{\"model\":\"claude-x\"}");
    putSharedSettings("{\"model\":\"\\t\"}");
    assertThat(workspaceService.get().model()).isEqualTo(AssistantDefaults.MODEL);
  }

  @Test
  void 공용_비서_앞뒤_공백은_떼고_저장한다() throws Exception {
    designateSharedAssistant();
    putSharedSettings("{\"model\":\"  claude-x  \"}");
    assertThat(workspaceService.get().model()).isEqualTo("claude-x");
  }

  @Test
  void 공용_비서_model_키가_없으면_기존_값을_유지하고_null_이면_기본값() throws Exception {
    designateSharedAssistant();
    putSharedSettings("{\"model\":\"claude-x\"}");

    putSharedSettings("{\"thinkingDepth\":\"HIGH\"}");
    assertThat(workspaceService.get().model()).isEqualTo("claude-x");

    putSharedSettings("{\"model\":null}");
    assertThat(workspaceService.get().model()).isEqualTo(AssistantDefaults.MODEL);
  }

  @Test
  void 개인_비서_공백만_든_모델명은_기본_모델로_되돌리고_앞뒤_공백은_뗀다() throws Exception {
    long human = TestFixtures.createHuman(dsl);
    personalService.registerCredential(human, "anthropic", TOKEN, "내 토큰", null);

    personalService.updateSettings(human, parse("{\"model\":\"  claude-x  \"}"));
    assertThat(personalService.getStatus(human).model()).isEqualTo("claude-x");

    personalService.updateSettings(human, parse("{\"model\":\"   \"}"));
    assertThat(personalService.getStatus(human).model()).isEqualTo(AssistantDefaults.MODEL);
  }

  private UpdateAssistantSettingsRequest parse(String json) throws Exception {
    return objectMapper.readValue(json, UpdateAssistantSettingsRequest.class);
  }
}
