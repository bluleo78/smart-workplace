package com.workplace.global.web;

import static com.workplace.jooq.Tables.MEMBERSHIP;
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
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 페이지 목록 API 의 size 상한(WP-644). 감사 로그·프로젝트·사용자 목록은 size 에 상한이 없어 size=999999 로 한 번에 수십만 행을 끌어올 수
 * 있었다 — 구성원 목록(WP-552)과 같은 100 을 넘으면 400 으로 거절한다. 웹·MCP 호출은 모두 100 이하다.
 *
 * <p>프로젝트 목록의 100 허용은 ProjectControllerTest 가 본다 — 목록 조회가 개인 프로젝트를 새 트랜잭션에서 만들어 롤백형 픽스처 사용자를 보지
 * 못한다.
 */
@Transactional
class ListSizeLimitIntegrationTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwtTokenProvider;

  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/admin/audit-logs", "/api/v1/projects", "/api/v1/users"})
  void size_가_100_을_넘으면_400(String path) throws Exception {
    String token = tokenForNewAdmin();
    mvc.perform(get(path).header("Authorization", "Bearer " + token).param("size", "999999"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.errors.size").value("size 는 1~100 이어야 합니다"));
    mvc.perform(get(path).header("Authorization", "Bearer " + token).param("size", "101"))
        .andExpect(status().isBadRequest());
  }

  @ParameterizedTest
  @ValueSource(strings = {"/api/v1/admin/audit-logs", "/api/v1/users"})
  void size_100_은_받는다(String path) throws Exception {
    mvc.perform(
            get(path).header("Authorization", "Bearer " + tokenForNewAdmin()).param("size", "100"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.size").value(100));
  }

  /** 테넌트#1 ACTIVE 멤버인 ADMIN 을 만들고 그 사람의 access token 을 돌려준다(감사 로그·사용자 목록 권한). */
  private String tokenForNewAdmin() {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "ls-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "ls")
            .set(USER.EMAIL, "ls-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, 1L)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
    return jwtTokenProvider.generateAccessToken(userId, "ls-" + suffix, 1L);
  }
}
