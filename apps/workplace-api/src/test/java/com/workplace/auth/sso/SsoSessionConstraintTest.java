package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.user.repository.UserRepository;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** amr=sso 세션은 SSO 켜진 워크스페이스만 선택·전환·갱신할 수 있다. 비밀번호 세션은 영향 없음. */
@AutoConfigureMockMvc
@Transactional
class SsoSessionConstraintTest extends SsoIntegrationTestBase {

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired AuthService authService;
  @Autowired UserRepository userRepository;
  @Autowired JwtTokenProvider jwt;

  long userId;
  long ssoA;
  long ssoB;
  long plain;

  @BeforeEach
  void seed() {
    userId = SsoTestData.user(dsl, SsoTestData.uniqueEmail("hong"), null);
    ssoA = SsoTestData.tenant(dsl, true);
    ssoB = SsoTestData.tenant(dsl, true);
    plain = SsoTestData.tenant(dsl, false);
    SsoTestData.member(dsl, userId, ssoA);
    SsoTestData.member(dsl, userId, ssoB);
    SsoTestData.member(dsl, userId, plain);
  }

  private UsernamePasswordAuthenticationToken ssoAuth() {
    var a = new UsernamePasswordAuthenticationToken(userId, null, java.util.List.of());
    a.setDetails(new AuthDetails(AuthDetails.SSO));
    return a;
  }

  @Test
  void ssoMemberships_filtersDisabledTenants() throws Exception {
    mvc.perform(get("/api/v1/auth/memberships").with(authentication(ssoAuth())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.length()").value(2))
        .andExpect(jsonPath("$[?(@.tenantId == " + plain + ")]").isEmpty());
  }

  @Test
  void passwordMemberships_unchanged() throws Exception {
    var pw = new UsernamePasswordAuthenticationToken(userId, null, java.util.List.of());
    mvc.perform(get("/api/v1/auth/memberships").with(authentication(pw)))
        .andExpect(jsonPath("$.length()").value(3));
  }

  @Test
  void ssoSelectTenant_disabledTenantForbidden_enabledOk() throws Exception {
    mvc.perform(
            post("/api/v1/auth/select-tenant")
                .with(authentication(ssoAuth()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tenantId\":" + plain + "}"))
        .andExpect(status().isForbidden());
    mvc.perform(
            post("/api/v1/auth/select-tenant")
                .with(authentication(ssoAuth()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"tenantId\":" + ssoA + "}"))
        .andExpect(status().isOk());
  }

  @Test
  void selectTenant_keepsAmrInIssuedTokens() {
    var token = authService.selectTenant(userId, ssoA, AuthDetails.SSO);
    assertThat(jwt.getAuthMethodFromToken(token.accessToken())).isEqualTo("sso");
    assertThat(jwt.getAuthMethodFromToken(token.refreshToken())).isEqualTo("sso");
  }

  @Test
  void refresh_afterSsoDisabled_rejectsOnlySsoSession() {
    var sso = authService.selectTenant(userId, ssoA, AuthDetails.SSO);
    var pw = authService.selectTenant(userId, ssoA, null);
    dsl.update(TENANT).set(TENANT.SSO_ENABLED, false).where(TENANT.ID.eq(ssoA)).execute();

    assertThatThrownBy(() -> authService.refresh(sso.refreshToken()))
        .isInstanceOf(InvalidTokenException.class);
    assertThat(authService.refresh(pw.refreshToken()).accessToken()).isNotBlank();
  }

  @Test
  void refresh_rotatesAndKeepsAmr() {
    var sso = authService.selectTenant(userId, ssoA, AuthDetails.SSO);
    var rotated = authService.refresh(sso.refreshToken());
    assertThat(jwt.getAuthMethodFromToken(rotated.refreshToken())).isEqualTo("sso");
  }

  @Test
  void issueSsoSession_autoSelectsSingleSsoTenant() {
    long solo = SsoTestData.user(dsl, SsoTestData.uniqueEmail("solo"), null);
    SsoTestData.member(dsl, solo, ssoA);
    SsoTestData.member(dsl, solo, plain);

    var session = authService.issueSsoSession(userRepository.findById(solo).orElseThrow());

    assertThat(session.tenantId()).isEqualTo(ssoA);
    assertThat(jwt.getTenantIdFromToken(session.refreshToken())).isEqualTo(ssoA);
    assertThat(jwt.getAuthMethodFromToken(session.refreshToken())).isEqualTo("sso");
  }

  @Test
  void issueSsoSession_multipleSsoTenantsIsTenantless() {
    var session = authService.issueSsoSession(userRepository.findById(userId).orElseThrow());
    assertThat(session.tenantId()).isNull();
    assertThat(jwt.getTenantIdFromToken(session.refreshToken())).isNull();
  }
}
