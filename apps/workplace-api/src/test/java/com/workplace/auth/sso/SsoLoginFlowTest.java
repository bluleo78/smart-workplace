package com.workplace.auth.sso;

import static com.workplace.jooq.Tables.AUDIT_LOG;
import static com.workplace.jooq.Tables.USER_EXTERNAL_IDENTITY;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import jakarta.servlet.http.Cookie;
import java.net.URI;
import org.jooq.DSLContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.util.UriComponentsBuilder;

/** SSO 로그인 흐름 — start·callback 을 가짜 IdP 로 끝까지. state 검증이 토큰 교환보다 먼저다. */
@Transactional
class SsoLoginFlowTest extends SsoIntegrationTestBase {

  private static final String TID = "11111111-2222-3333-4444-555555555555";

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;

  long tenantId;
  String email;
  long userId;

  @BeforeEach
  void seed() {
    tenantId = SsoTestData.tenant(dsl, true);
    email = SsoTestData.uniqueEmail("flow");
    userId = SsoTestData.user(dsl, email, null);
    SsoTestData.member(dsl, userId, tenantId);
  }

  /** start 를 호출해 트랜잭션 쿠키와 인가 URL 의 state/nonce 를 얻는다. */
  private record Started(Cookie tx, String state, String nonce) {}

  private Started start(String returnTo) throws Exception {
    MvcResult r =
        mvc.perform(get("/api/v1/auth/sso/start").param("returnTo", returnTo))
            .andExpect(status().isFound())
            .andReturn();
    var q =
        UriComponentsBuilder.fromUri(URI.create(r.getResponse().getRedirectedUrl()))
            .build()
            .getQueryParams();
    return new Started(
        r.getResponse().getCookie(SsoTransactionCookie.NAME),
        q.getFirst("state"),
        q.getFirst("nonce"));
  }

  private MvcResult callback(Started s, String state) throws Exception {
    return mvc.perform(
            get("/api/v1/auth/sso/callback")
                .cookie(s.tx())
                .param("code", "c1")
                .param("state", state))
        .andExpect(status().isFound())
        .andReturn();
  }

  private void idpReturns(String oid, String upn, Started s) {
    FAKE.claims(
        f -> FAKE.claimsBuilder(TID, oid).claim("nonce", s.nonce()).claim("upn", upn).build());
  }

  @Test
  void status_reportsAvailability() throws Exception {
    mvc.perform(get("/api/v1/auth/sso/status"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.m365").value(true));
  }

  @Test
  void start_redirectsWithPkceAndSetsTxCookie() throws Exception {
    Started s = start("/projects/WP");
    assertThat(s.tx()).isNotNull();
    assertThat(s.tx().isHttpOnly()).isTrue();
    assertThat(s.state()).hasSize(43);
  }

  @Test
  void happyPath_setsRefreshCookieAndRedirectsToComplete() throws Exception {
    Started s = start("/projects/WP");
    idpReturns("oid-flow", email, s);

    MvcResult r = callback(s, s.state());

    assertThat(r.getResponse().getRedirectedUrl())
        .isEqualTo("/login/sso/complete?returnTo=%2Fprojects%2FWP");
    assertThat(r.getResponse().getCookie("refreshToken").getValue()).isNotBlank();
    assertThat(r.getResponse().getCookie(SsoTransactionCookie.NAME).getMaxAge()).isZero();
    assertThat(dsl.fetchCount(USER_EXTERNAL_IDENTITY, USER_EXTERNAL_IDENTITY.USER_ID.eq(userId)))
        .isEqualTo(1);
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG.USER_ID.eq(userId).and(AUDIT_LOG.ACTION_TYPE.eq("USER_SSO_LINK"))))
        .isEqualTo(1);
  }

  @Test
  void unregistered_isDeniedAndAudited() throws Exception {
    Started s = start("/");
    idpReturns("oid-x", SsoTestData.uniqueEmail("ghost"), s);

    MvcResult r = callback(s, s.state());

    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_error=denied");
    assertThat(r.getResponse().getCookie("refreshToken")).isNull();
    assertThat(
            dsl.fetchCount(
                AUDIT_LOG,
                AUDIT_LOG
                    .ACTION_TYPE
                    .eq("LOGIN_FAILED")
                    .and(AUDIT_LOG.DESCRIPTION.contains("not_registered"))))
        .isPositive();
  }

  @Test
  void stateMismatch_isRetryWithoutTokenCall() throws Exception {
    Started s = start("/");
    idpReturns("oid-flow", email, s);
    MvcResult r = callback(s, "forged-state");
    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_error=retry");
    assertThat(FAKE.tokenCalls()).isZero();
  }

  @Test
  void callbackWithoutCookie_isRetryWithoutTokenCall() throws Exception {
    MvcResult r =
        mvc.perform(get("/api/v1/auth/sso/callback").param("code", "c1").param("state", "s"))
            .andExpect(status().isFound())
            .andReturn();
    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_error=retry");
    assertThat(FAKE.tokenCalls()).isZero();
  }

  @Test
  void tamperedCookie_isRetryWithoutTokenCall() throws Exception {
    Started s = start("/");
    Cookie bad = new Cookie(SsoTransactionCookie.NAME, "x" + s.tx().getValue().substring(1));
    MvcResult r =
        mvc.perform(
                get("/api/v1/auth/sso/callback")
                    .cookie(bad)
                    .param("code", "c")
                    .param("state", s.state()))
            .andReturn();
    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_error=retry");
    assertThat(FAKE.tokenCalls()).isZero();
  }

  @Test
  void userCancel_isRetry() throws Exception {
    Started s = start("/");
    MvcResult r =
        mvc.perform(
                get("/api/v1/auth/sso/callback")
                    .cookie(s.tx())
                    .param("state", s.state())
                    .param("error", "access_denied")
                    .param("error_description", "AADSTS65004: User declined to consent"))
            .andReturn();
    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_error=retry");
  }

  @Test
  void adminConsentRequired_isConsent() throws Exception {
    Started s = start("/");
    MvcResult r =
        mvc.perform(
                get("/api/v1/auth/sso/callback")
                    .cookie(s.tx())
                    .param("state", s.state())
                    .param("error", "access_denied")
                    .param("error_description", "AADSTS90094: admin approval required"))
            .andReturn();
    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_error=consent");
  }

  @Test
  void adminConsentDenied_errorOnlyWithoutState_redirectsConsent() throws Exception {
    // 관리자 동의 화면 취소 시 Microsoft 는 state·admin_consent 없이 error 만 보낸다.
    MvcResult r =
        mvc.perform(
                get("/api/v1/auth/sso/callback")
                    .param("error", "access_denied")
                    .param("error_description", "AADSTS65004: User declined to consent"))
            .andReturn();
    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_error=consent");
    assertThat(FAKE.tokenCalls()).isZero();
  }

  @Test
  void adminConsentReturn_withoutCookie_showsNotice() throws Exception {
    MvcResult r =
        mvc.perform(
                get("/api/v1/auth/sso/callback")
                    .param("admin_consent", "True")
                    .param("tenant", TID))
            .andReturn();
    assertThat(r.getResponse().getRedirectedUrl()).isEqualTo("/login?sso_notice=consented");
    assertThat(FAKE.tokenCalls()).isZero();
  }

  @Test
  void invalidGrant_isRetry() throws Exception {
    Started s = start("/");
    FAKE.failTokenEndpoint(400, "{\"error\":\"invalid_grant\"}");
    assertThat(callback(s, s.state()).getResponse().getRedirectedUrl())
        .isEqualTo("/login?sso_error=retry");
  }

  @Test
  void returnTo_isSanitized() throws Exception {
    Started s = start("//evil.com");
    idpReturns("oid-flow", email, s);
    assertThat(callback(s, s.state()).getResponse().getRedirectedUrl())
        .isEqualTo("/login/sso/complete?returnTo=%2F");
  }
}
