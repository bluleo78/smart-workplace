package com.workplace.global.exception;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * NUL(U+0000) 이 든 입력은 한국어 400 으로 거절한다(WP-739).
 *
 * <p>PostgreSQL 은 text 에 NUL 을 저장하지 못하고(SQLState 22021) jsonb 의 {@code \u0000} 도 받지 않는다(22P05). 이
 * 오류가 무결성 위반 409 「저장할 수 없는 값이 있어…」로 나가, 클라이언트가 고칠 입력 오류인데 충돌처럼 보였다. 본문(이슈·위키·메시지·설명)·검색어·jsonb 값 등
 * 정리하지 않는 칸 어디서든 같은 오류라, 경로마다가 아니라 오류 응답 한곳에서 400 으로 바꾼다.
 */
@Transactional
class NulCharacterInputTest extends IntegrationTestBase {

  private static final String MESSAGE = "입력값에 쓸 수 없는 문자(NUL)가 들어 있습니다";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private String token;

  @BeforeEach
  void user() {
    long id = TestFixtures.createHuman(dsl);
    TestFixtures.grantRole(dsl, id, "USER");
    TestFixtures.activeMemberOfCurrentTenant(dsl, id);
    token = jwtTokenProvider.generateAccessToken(id, "nul-" + id, 1L);
  }

  @Test
  void 프로젝트_설명에_NUL_이_있으면_400() throws Exception {
    mvc.perform(
            post("/api/v1/projects")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"key\":\"NUL"
                        + (System.nanoTime() % 1000)
                        + "\",\"name\":\"x\",\"type\":\"TEAM\",\"description\":\"a\\u0000b\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(MESSAGE));
  }

  @Test
  void 구성원_검색어에_NUL_이_있으면_400() throws Exception {
    mvc.perform(
            get("/api/v1/members")
                .param("search", "a\u0000b")
                .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(MESSAGE));
  }

  @Test
  void 대시보드_jsonb_값에_NUL_이_있으면_400() throws Exception {
    mvc.perform(
            put("/api/v1/me/dashboard")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"widgets\":[{\"id\":\"w-1\",\"type\":\"issue_list\",\"order\":0,\"hidden\":false,"
                        + "\"params\":{\"assignee\":\"a\\u0000b\"},\"label\":\"x\"}]}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value(MESSAGE));
  }
}
