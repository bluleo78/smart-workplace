package com.workplace.user.controller;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** WP-139: 사용자 AI 추천 질문 켜기/끄기 — 기본(NULL)은 켜짐, PUT 왕복, 필수값 누락 400. */
@Transactional
class AiPreferenceControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  private Authentication auth(long userId) {
    return new UsernamePasswordAuthenticationToken(userId, "n/a", List.of());
  }

  @Test
  void 설정한_적이_없으면_켜짐으로_보인다() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    mvc.perform(get("/api/v1/users/me/ai-preferences").with(authentication(auth(uid))))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.suggestionsEnabled").value(true));
  }

  @Test
  void 끄고_다시_켜는_왕복() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    mvc.perform(
            put("/api/v1/users/me/ai-preferences")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"suggestionsEnabled\":false}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.suggestionsEnabled").value(false));
    mvc.perform(get("/api/v1/users/me/ai-preferences").with(authentication(auth(uid))))
        .andExpect(jsonPath("$.suggestionsEnabled").value(false));

    mvc.perform(
            put("/api/v1/users/me/ai-preferences")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"suggestionsEnabled\":true}"))
        .andExpect(jsonPath("$.suggestionsEnabled").value(true));
  }

  @Test
  void 값이_없으면_400() throws Exception {
    long uid = TestFixtures.createHuman(dsl);
    mvc.perform(
            put("/api/v1/users/me/ai-preferences")
                .with(authentication(auth(uid)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isBadRequest());
  }
}
