package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.RegisterAssistantCredentialRequest;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 멀티 프로바이더(#opencode) 확장: MyAssistantController `PUT /credential` 통합 테스트 — 구 `/token` 경로는
 * 제거되었다(하위호환 라우트 없음).
 */
@AutoConfigureMockMvc
@Transactional
class MyAssistantControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;

  /** 개인 비서 최초 등록은 신규 AGENT 멤버십 프로비저닝에 active 테넌트 컨텍스트가 필요 — 인증된 요청을 시뮬레이트. */
  @BeforeEach
  void setTenant() {
    TenantContext.set(1L);
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private Authentication authWith(Long userId) {
    return new UsernamePasswordAuthenticationToken(userId, "n/a", java.util.List.of());
  }

  @Test
  void register_credential_생략시_anthropic_하위호환_204() throws Exception {
    Long human = createHumanUserForTest();
    var req = new RegisterAssistantCredentialRequest(null, "X".repeat(64), null, null, "내 토큰");
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isNoContent());

    mvc.perform(get("/api/v1/users/me/assistant").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.configured").value(true))
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.baseUrl").doesNotExist());
  }

  @Test
  void register_credential_opencode_등록시_상태에_provider와_baseUrl_반영() throws Exception {
    Long human = createHumanUserForTest();
    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req =
        new RegisterAssistantCredentialRequest("opencode", null, config, "gpt-4.1", "opencode");
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isNoContent());

    mvc.perform(get("/api/v1/users/me/assistant").with(authentication(authWith(human))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.configured").value(true))
        .andExpect(jsonPath("$.provider").value("opencode"))
        .andExpect(jsonPath("$.baseUrl").value("https://api.example.com/v1"))
        .andExpect(jsonPath("$.model").value("gpt-4.1"));
  }

  @Test
  void register_credential_opencode_model_누락시_400() throws Exception {
    Long human = createHumanUserForTest();
    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req = new RegisterAssistantCredentialRequest("opencode", null, config, null, null);
    mvc.perform(
            put("/api/v1/users/me/assistant/credential")
                .with(authentication(authWith(human)))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isBadRequest());
  }

  private Long createHumanUserForTest() {
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
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }
}
