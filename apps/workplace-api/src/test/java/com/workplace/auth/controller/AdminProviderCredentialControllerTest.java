package com.workplace.auth.controller;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.ProviderConfig;
import com.workplace.auth.dto.ProviderCredentialRegisterRequest;
import com.workplace.support.IntegrationTestBase;
import java.util.Map;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 멀티 프로바이더(#opencode) 확장: AdminProviderCredentialController 통합 테스트 — 권한/HTTP/응답 형태 검증. 구
 * `/oauth-token` 경로는 제거되었다(하위호환 라우트 없음).
 */
@AutoConfigureMockMvc
@Transactional
class AdminProviderCredentialControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired ObjectMapper objectMapper;
  @Autowired DSLContext dsl;

  /** 컨트롤러가 (Long) auth.getPrincipal() 캐스트하므로 principal 을 Long 으로 직접 세팅. */
  private Authentication authWith(Long userId, String... permissions) {
    var authorities =
        java.util.Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList();
    return new UsernamePasswordAuthenticationToken(userId, "n/a", authorities);
  }

  @Test
  void no_permission_returns_403() throws Exception {
    Long admin = createHumanUserForTest();
    var req = new ProviderCredentialRegisterRequest(null, "X".repeat(64), null, null, null);
    mvc.perform(
            post("/api/v1/admin/agents/9999/provider-credential")
                .with(authentication(authWith(admin, "agent_unauthorized")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isForbidden());
  }

  @Test
  void register_생략시_anthropic_하위호환_그리고_평문미포함() throws Exception {
    Long admin = createHumanUserForTest();
    Long agentId = createAgentUserForTest();
    var req = new ProviderCredentialRegisterRequest(null, "X".repeat(64), null, null, "main");
    mvc.perform(
            post("/api/v1/admin/agents/" + agentId + "/provider-credential")
                .with(authentication(authWith(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.provider").value("anthropic"))
        .andExpect(jsonPath("$.baseUrl").doesNotExist())
        .andExpect(jsonPath("$.label").value("main"))
        .andExpect(jsonPath("$.token").doesNotExist())
        .andExpect(jsonPath("$.encryptedToken").doesNotExist());
  }

  @Test
  void register_opencode_등록시_provider와_baseUrl_메타반환() throws Exception {
    Long admin = createHumanUserForTest();
    Long agentId = createAgentUserForTest();
    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req =
        new ProviderCredentialRegisterRequest("opencode", null, config, "gpt-4.1", "opencode-main");
    mvc.perform(
            post("/api/v1/admin/agents/" + agentId + "/provider-credential")
                .with(authentication(authWith(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.provider").value("opencode"))
        .andExpect(jsonPath("$.baseUrl").value("https://api.example.com/v1"))
        .andExpect(jsonPath("$.label").value("opencode-main"));
  }

  @Test
  void register_opencode_model_누락시_400() throws Exception {
    Long admin = createHumanUserForTest();
    Long agentId = createAgentUserForTest();
    var config =
        new ProviderConfig(
            "openai", null, Map.of("baseURL", "https://api.example.com/v1", "apiKey", "sk-xxxx"));
    var req = new ProviderCredentialRegisterRequest("opencode", null, config, null, null);
    mvc.perform(
            post("/api/v1/admin/agents/" + agentId + "/provider-credential")
                .with(authentication(authWith(admin, "user:write")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(req)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void delete_returns_204() throws Exception {
    Long admin = createHumanUserForTest();
    Long agentId = createAgentUserForTest();
    mvc.perform(
            delete("/api/v1/admin/agents/" + agentId + "/provider-credential")
                .with(authentication(authWith(admin, "user:write"))))
        .andExpect(status().isNoContent());
  }

  @Test
  void get_meta_without_active_returns_404() throws Exception {
    Long admin = createHumanUserForTest();
    Long agentId = createAgentUserForTest();
    mvc.perform(
            get("/api/v1/admin/agents/" + agentId + "/provider-credential")
                .with(authentication(authWith(admin, "user:write"))))
        .andExpect(status().isNotFound());
  }

  /** IssueAssigneeServiceTest.createAgentUser 패턴 — AGENT user 1명 생성 후 id 반환. */
  private Long createAgentUserForTest() {
    return createUserForTest("ai", "AGENT");
  }

  private Long createHumanUserForTest() {
    return createUserForTest("admin", "HUMAN");
  }

  private Long createUserForTest(String prefix, String kind) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .set(USER.KIND, kind)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    if ("HUMAN".equals(kind)) {
      dsl.update(USER).set(USER.PASSWORD, "pw").where(USER.ID.eq(id)).execute();
    }
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }
}
