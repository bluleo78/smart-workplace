package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;

/** PlatformAuthController 통합 테스트 — 운영자 로그인 200·쿠키·바디, 비운영자 403, 발급 토큰으로 /me 200 을 검증한다. */
@AutoConfigureMockMvc
@Transactional
class PlatformAuthControllerTest extends IntegrationTestBase {

  private static final String RAW_PASSWORD = "Platform1!";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired PasswordEncoder passwordEncoder;
  @Autowired ObjectMapper objectMapper;

  /** HUMAN 사용자 시드(비밀번호 인코딩). 반환은 username. */
  private String createHumanUser(String prefix, boolean platformAdmin) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    String username = prefix + "-" + suffix;
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, username)
            .set(USER.PASSWORD, passwordEncoder.encode(RAW_PASSWORD))
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, username + "@example.com")
            .set(USER.IS_PLATFORM_ADMIN, platformAdmin)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return username;
  }

  private String loginBody(String username) throws Exception {
    return objectMapper.writeValueAsString(
        new com.workplace.platform.dto.PlatformLoginRequest(username, RAW_PASSWORD));
  }

  @Test
  void login_platformAdmin_returns200WithCookieAndBody() throws Exception {
    String username = createHumanUser("admin", true);

    mvc.perform(
            post("/api/platform/auth/login")
                .contentType("application/json")
                .content(loginBody(username)))
        .andExpect(status().isOk())
        .andExpect(cookie().exists("platformRefreshToken"))
        .andExpect(cookie().httpOnly("platformRefreshToken", true))
        .andExpect(jsonPath("$.accessToken").isNotEmpty())
        .andExpect(jsonPath("$.tokenType").value("Bearer"));
  }

  @Test
  void login_nonPlatformAdmin_returns403() throws Exception {
    String username = createHumanUser("normal", false);

    mvc.perform(
            post("/api/platform/auth/login")
                .contentType("application/json")
                .content(loginBody(username)))
        .andExpect(status().isForbidden());
  }

  @Test
  void me_withIssuedPlatformToken_returnsSelf() throws Exception {
    String username = createHumanUser("admin", true);

    MvcResult loginResult =
        mvc.perform(
                post("/api/platform/auth/login")
                    .contentType("application/json")
                    .content(loginBody(username)))
            .andExpect(status().isOk())
            .andReturn();

    JsonNode body = objectMapper.readTree(loginResult.getResponse().getContentAsString());
    String accessToken = body.get("accessToken").asText();
    assertThat(accessToken).isNotBlank();

    mvc.perform(get("/api/platform/auth/me").header("Authorization", "Bearer " + accessToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.username").value(username));
  }
}
