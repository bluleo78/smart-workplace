package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.JwtTokenProvider;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 운영자 콘솔 — 전역 사용자 이메일 조회 컨트롤러 통합 테스트. */
@AutoConfigureMockMvc
@Transactional
class PlatformUserControllerTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  private long createHumanUser(String prefix, String email) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, email)
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String platformToken() {
    long operator = createHumanUser("operator", "op-" + UUID.randomUUID() + "@example.com");
    return jwtTokenProvider.generatePlatformAccessToken(operator, "operator");
  }

  @Test
  void lookup_found_returns200() throws Exception {
    String email = "found-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    long userId = createHumanUser("찾음", email);
    String auth = "Bearer " + platformToken();

    mvc.perform(
            get("/api/platform/users/lookup").param("email", email).header("Authorization", auth))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.userId").value(userId))
        .andExpect(jsonPath("$.email").value(email))
        .andExpect(jsonPath("$.isPlatformAdmin").value(false));
  }

  @Test
  void lookup_notFound_returns404() throws Exception {
    String auth = "Bearer " + platformToken();

    mvc.perform(
            get("/api/platform/users/lookup")
                .param("email", "nobody-" + UUID.randomUUID() + "@example.com")
                .header("Authorization", auth))
        .andExpect(status().isNotFound());
  }
}
