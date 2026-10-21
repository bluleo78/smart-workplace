package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 인증 없이 열어 둔 경로는 이 앱에 실제로 있는 것만이어야 한다(WP-673). 다른 앱(firehub)에서 옮겨 온 triggers·slack
 * inbound·kakao/slack OAuth 콜백 허용이 남아 있어, 같은 경로로 API 를 추가하면 인증 없이 그대로 공개될 뻔했다.
 */
class SecurityPublicPathsTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;

  /** 걷어낸 경로는 다른 /api/v1 경로처럼 토큰이 없으면 401 이다(예전엔 인증을 건너뛰어 404). */
  @ParameterizedTest
  @ValueSource(
      strings = {
        "/api/v1/triggers/api/x",
        "/api/v1/triggers/webhook/x",
        "/api/v1/channels/slack/inbound",
        "/api/v1/oauth/kakao/callback",
        "/api/v1/oauth/slack/callback"
      })
  void 없는_경로의_공개_허용을_걷어내_토큰_없으면_401(String path) throws Exception {
    mvc.perform(get(path)).andExpect(status().isUnauthorized());
    mvc.perform(post(path)).andExpect(status().isUnauthorized());
  }

  /** 실제로 쓰는 M365 메일 연결 완료는 여전히 토큰 없이 닿는다 — 프론트 콜백이 state 로 중계한다. */
  @Test
  void m365_메일_연결_완료는_계속_공개() throws Exception {
    int code =
        mvc.perform(
                post("/api/v1/mail/oauth/m365/complete")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{}"))
            .andReturn()
            .getResponse()
            .getStatus();
    assertThat(code).isNotEqualTo(401).isNotEqualTo(403);
  }
}
