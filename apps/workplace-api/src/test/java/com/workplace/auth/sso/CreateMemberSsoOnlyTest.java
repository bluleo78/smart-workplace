package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 구성원 추가 — 비밀번호 없는 SSO 전용 계정. */
@AutoConfigureMockMvc
@Transactional
class CreateMemberSsoOnlyTest extends SsoIntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  // 기본 테넌트(1) 사용 — createMember 가 쓰는 user_role 은 RLS 대상이라 트랜잭션 시작 시 GUC 가 있어야 한다
  // (IntegrationTestBase 의 @BeforeTransaction 이 1 을 심는다). sso_enabled 변경은 테스트 롤백으로 되돌아간다.
  long tenantId = 1L;
  // 감사 로그(audit_log.user_id FK)에 기록될 실제 관리자 사용자 id
  long adminId;

  @BeforeEach
  void seed() {
    dsl.update(com.workplace.jooq.Tables.TENANT)
        .set(com.workplace.jooq.Tables.TENANT.SSO_ENABLED, true)
        .where(com.workplace.jooq.Tables.TENANT.ID.eq(tenantId))
        .execute();
    adminId = SsoTestData.user(dsl, SsoTestData.uniqueEmail("admin"), "hash");
    SsoTestData.member(dsl, adminId, tenantId);
  }

  private UsernamePasswordAuthenticationToken admin() {
    return new UsernamePasswordAuthenticationToken(
        adminId,
        null,
        List.of(
            new SimpleGrantedAuthority("user:write"), new SimpleGrantedAuthority("role:assign")));
  }

  private org.springframework.test.web.servlet.ResultActions create(
      String username, String passwordJson) throws Exception {
    String body =
        "{\"username\":\"" + username + "\",\"name\":\"홍\",\"role\":\"USER\"" + passwordJson + "}";
    return mvc.perform(
        post("/api/v1/users")
            .with(authentication(admin()))
            .contentType(MediaType.APPLICATION_JSON)
            .content(body));
  }

  @Test
  void ssoOnly_createsPasswordlessLowercasedUser() throws Exception {
    String email = SsoTestData.uniqueEmail("Hong");
    create(email, "").andExpect(status().isCreated());
    var row = dsl.selectFrom(USER).where(USER.USERNAME.eq(email.toLowerCase())).fetchOne();
    assertThat(row).isNotNull();
    assertThat(row.getPassword()).isNull();
  }

  @Test
  void ssoOnly_rejectedWhenTenantSsoOff() throws Exception {
    dsl.update(com.workplace.jooq.Tables.TENANT)
        .set(com.workplace.jooq.Tables.TENANT.SSO_ENABLED, false)
        .where(com.workplace.jooq.Tables.TENANT.ID.eq(tenantId))
        .execute();
    create(SsoTestData.uniqueEmail("off"), "").andExpect(status().isConflict());
  }

  @Test
  void ssoOnly_requiresEmailUsername() throws Exception {
    create("jane", "").andExpect(status().isBadRequest());
  }

  @Test
  void ssoOnly_rejectsCaseInsensitiveDuplicate() throws Exception {
    String email = SsoTestData.uniqueEmail("dup");
    SsoTestData.user(dsl, email.toUpperCase(), "hash");
    create(email, "").andExpect(status().isConflict());
  }

  /** WP-48: 비밀번호 구성원 경로도 아이디 중복을 대소문자 무시로 검사 — SSO 전용 계정과 대소문자만 다른 계정이 생기지 않게. */
  @Test
  void passwordMember_rejectsCaseInsensitiveDuplicateOfSsoOnly() throws Exception {
    String email = SsoTestData.uniqueEmail("alice");
    SsoTestData.user(dsl, email, null);
    create(email.toUpperCase(), ",\"password\":\"Password123\"").andExpect(status().isConflict());
  }

  @Test
  void passwordMember_unchanged() throws Exception {
    create("pw-user-" + System.nanoTime(), ",\"password\":\"Password123\"")
        .andExpect(status().isCreated());
  }

  @Test
  void ssoOnlyAccount_passwordLoginFailsGenerically() throws Exception {
    String email = SsoTestData.uniqueEmail("nopw");
    create(email, "").andExpect(status().isCreated());
    mvc.perform(
            post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                    "{\"username\":\"" + email.toLowerCase() + "\",\"password\":\"Anything123\"}"))
        .andExpect(status().isUnauthorized());
  }
}
