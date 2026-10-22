package com.workplace.global.security;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.hamcrest.Matchers;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * 로그인이 필요한 401 응답(WP-824) — 다른 오류와 같은 모양(status·error·message·errors·timestamp·path)에 한국어 문구로 답한다.
 * 고치기 전에는 Spring Security 기본 영어 문구 「Full authentication is required…」를 문자열로 이어 붙인 JSON 이었고, 문자셋도
 * ISO-8859-1 이었다.
 */
class UnauthorizedResponseTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;

  private ResultActions expectCommonShape(ResultActions r, String path) throws Exception {
    return r.andExpect(status().isUnauthorized())
        .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
        .andExpect(content().encoding("UTF-8"))
        .andExpect(jsonPath("$.status").value(401))
        .andExpect(jsonPath("$.error").value("Unauthorized"))
        .andExpect(jsonPath("$.message").value("로그인이 필요합니다. 다시 로그인해 주세요."))
        .andExpect(jsonPath("$.timestamp").isNotEmpty())
        .andExpect(jsonPath("$.path").value(path))
        .andExpect(
            jsonPath("$.message", Matchers.not(Matchers.containsString("Full authentication"))));
  }

  @Test
  void 토큰_없이_부르면_공통_모양의_한국어_401() throws Exception {
    expectCommonShape(mvc.perform(get("/api/v1/projects")), "/api/v1/projects");
  }

  @Test
  void 잘못된_토큰도_같은_모양의_401() throws Exception {
    expectCommonShape(
        mvc.perform(get("/api/v1/projects").header("Authorization", "Bearer not-a-jwt")),
        "/api/v1/projects");
  }
}
