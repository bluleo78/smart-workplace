package com.workplace.auth.sso;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.security.AuthDetails;
import com.workplace.user.repository.UserRepository;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 본인 비밀번호 설정 — 비밀번호 없는 계정은 현재 비밀번호 없이 설정, 있는 계정은 기존대로. */
@Transactional
class SetPasswordTest extends SsoIntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired UserRepository userRepository;
  @Autowired PasswordEncoder encoder;

  private UsernamePasswordAuthenticationToken self(long id) {
    return SsoTestData.auth(id, null, "user:write:self");
  }

  /** SSO 로 로그인한 브라우저 세션(amr=sso) — JwtAuthenticationFilter 가 details 를 싣는 형태. */
  private UsernamePasswordAuthenticationToken ssoSelf(long id) {
    return SsoTestData.auth(id, AuthDetails.SSO, "user:write:self");
  }

  @Test
  void passwordless_setsWithoutCurrent_andMeReportsHasPassword() throws Exception {
    long id = SsoTestData.user(dsl, SsoTestData.uniqueEmail("sso"), null);
    SsoTestData.member(dsl, id, 1L);
    mvc.perform(get("/api/v1/users/me").with(authentication(ssoSelf(id))))
        .andExpect(jsonPath("$.hasPassword").value(false));

    mvc.perform(
            put("/api/v1/users/me/password")
                .with(authentication(ssoSelf(id)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"newPassword\":\"Password123\"}"))
        .andExpect(status().isNoContent());

    assertThat(userRepository.hasPassword(id)).isTrue();
    mvc.perform(get("/api/v1/users/me").with(authentication(ssoSelf(id))))
        .andExpect(jsonPath("$.hasPassword").value(true));
  }

  @Test
  void passwordless_nonSsoSession_isRejected() throws Exception {
    // PAT(swp_)·Internal(X-On-Behalf-Of) 인증은 details 가 없다 — 이 경로로 SSO 전용 계정에 비밀번호를 심을 수 없어야 한다.
    long id = SsoTestData.user(dsl, SsoTestData.uniqueEmail("pat"), null);
    mvc.perform(
            put("/api/v1/users/me/password")
                .with(authentication(self(id)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"newPassword\":\"Password123\"}"))
        .andExpect(status().isBadRequest());
    assertThat(userRepository.hasPassword(id)).isFalse();
  }

  @Test
  void existingPassword_stillRequiresCurrent() throws Exception {
    long id = SsoTestData.user(dsl, SsoTestData.uniqueEmail("pw"), encoder.encode("Password123"));
    mvc.perform(
            put("/api/v1/users/me/password")
                .with(authentication(self(id)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"newPassword\":\"Password456\"}"))
        .andExpect(status().isBadRequest());
    mvc.perform(
            put("/api/v1/users/me/password")
                .with(authentication(self(id)))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"Password123\",\"newPassword\":\"Password456\"}"))
        .andExpect(status().isNoContent());
  }
}
