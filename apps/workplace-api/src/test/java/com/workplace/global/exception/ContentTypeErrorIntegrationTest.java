package com.workplace.global.exception;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 요청 Content-Type 이 API 가 받는 형식과 다를 때 415 + 한국어 안내(WP-632). 예전엔 처리기가 없어 500 「An unexpected error
 * occurred」와 ERROR 스택 로그가 남았다 — 로그인 전 공개 경로에서도 누구나 요청마다 남길 수 있었다.
 */
@Transactional
class ContentTypeErrorIntegrationTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private static final String MESSAGE = "지원하지 않는 요청 형식입니다";

  @Test
  void 로그인에_text_plain_을_보내면_415() throws Exception {
    mvc.perform(post("/api/v1/auth/login").contentType(MediaType.TEXT_PLAIN).content("x"))
        .andExpect(status().isUnsupportedMediaType())
        .andExpect(jsonPath("$.message").value(MESSAGE));
  }

  @Test
  void 파일_업로드에_JSON_이나_형식_없이_보내면_415() throws Exception {
    String token = tokenForNewUser();
    mvc.perform(
            post("/api/v1/files")
                .header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}"))
        .andExpect(status().isUnsupportedMediaType())
        .andExpect(jsonPath("$.message").value(MESSAGE));
    mvc.perform(post("/api/v1/files").header("Authorization", "Bearer " + token).content("hello"))
        .andExpect(status().isUnsupportedMediaType())
        .andExpect(jsonPath("$.message").value(MESSAGE));
  }

  /** 테넌트#1 ACTIVE 멤버인 USER 를 만들고 그 사람의 access token 을 돌려준다. */
  private String tokenForNewUser() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ct-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "ct")
            .set(USER.EMAIL, "ct-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, id)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return jwtTokenProvider.generateAccessToken(id, "ct-" + suffix, 1L);
  }
}
