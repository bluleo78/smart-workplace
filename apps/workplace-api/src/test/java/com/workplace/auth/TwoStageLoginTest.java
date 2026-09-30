package com.workplace.auth;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 2단계 로그인(login→select-tenant) 통합 검증. @Transactional 롤백으로 시드 데이터는 남지 않는다. */
@Transactional
class TwoStageLoginTest extends IntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired PasswordEncoder passwordEncoder;

  private Long userId;
  private Long tenantId;

  @BeforeEach
  void setUp() {
    userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "two@example.com")
            .set(USER.PASSWORD, passwordEncoder.encode("Password123"))
            .set(USER.NAME, "Two")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    tenantId =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "TwoCo")
            .set(TENANT.SLUG, "twoco-" + userId)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();
  }

  /**
   * 컨트롤러가 (Long) auth.getPrincipal() 캐스트하므로 principal 을 Long 으로 세팅. select-tenant 는 브라우저 JWT 세션만
   * 허용하므로(WP-48) JWT 필터처럼 비밀번호 세션 details 를 붙인다.
   */
  private Authentication authWith(Long uid) {
    var auth = new UsernamePasswordAuthenticationToken(uid, "n/a", java.util.List.of());
    auth.setDetails(
        new com.workplace.global.security.AuthDetails(
            com.workplace.global.security.AuthDetails.PASSWORD));
    return auth;
  }

  @Test
  void login_returnsMembershipsAndTenantlessToken() throws Exception {
    mvc.perform(
            post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"two@example.com\",\"password\":\"Password123\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accessToken").exists())
        .andExpect(jsonPath("$.memberships[?(@.tenantId == " + tenantId + ")]").exists());
  }

  @Test
  void selectTenant_issuesTenantScopedToken() throws Exception {
    mvc.perform(
            post("/api/v1/auth/select-tenant")
                .with(authentication(authWith(userId)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tenantId\":" + tenantId + "}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accessToken").exists());
  }

  @Test
  void selectTenant_rejectsNonMemberTenant() throws Exception {
    Long otherTenant =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, "Other")
            .set(TENANT.SLUG, "other-" + userId)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    mvc.perform(
            post("/api/v1/auth/select-tenant")
                .with(authentication(authWith(userId)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tenantId\":" + otherTenant + "}"))
        .andExpect(status().isForbidden());
  }

  @Test
  void selectTenant_rejectsSuspendedTenant() throws Exception {
    dsl.update(TENANT).set(TENANT.STATUS, "SUSPENDED").where(TENANT.ID.eq(tenantId)).execute();

    mvc.perform(
            post("/api/v1/auth/select-tenant")
                .with(authentication(authWith(userId)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tenantId\":" + tenantId + "}"))
        .andExpect(status().isForbidden());
  }
}
