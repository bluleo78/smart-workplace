package com.workplace.auth.sso;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.security.JwtProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseCookie;

/** 트랜잭션 쿠키 — 서명·만료·변조 거부와 PKCE challenge. */
class SsoTransactionCookieTest {

  private static final JwtProperties JWT =
      new JwtProperties("dGVzdC1qd3Qtc2VjcmV0LWtleS1mb3ItaW50ZWdyYXRpb24tdGVzdHMtb25seS11c2U=", 1, 1, 1);

  private final Instant now = Instant.parse("2026-09-29T00:00:00Z");
  private final SsoTransactionCookie cookie =
      new SsoTransactionCookie(JWT, true, Clock.fixed(now, ZoneOffset.UTC));

  @Test
  void roundTrip_preservesValuesAndSanitizesReturnTo() {
    SsoTransactionCookie.Tx tx = cookie.create("https://evil.com");
    ResponseCookie c = cookie.toCookie(tx);

    assertThat(c.getName()).isEqualTo("swp_sso_tx");
    assertThat(c.getPath()).isEqualTo("/api/v1/auth/sso");
    assertThat(c.isHttpOnly()).isTrue();
    assertThat(c.isSecure()).isTrue();
    assertThat(c.getSameSite()).isEqualTo("Lax");
    assertThat(c.getMaxAge()).isEqualTo(Duration.ofMinutes(10));

    SsoTransactionCookie.Tx read = cookie.read(c.getValue()).orElseThrow();
    assertThat(read.state()).isEqualTo(tx.state());
    assertThat(read.nonce()).isEqualTo(tx.nonce());
    assertThat(read.codeVerifier()).isEqualTo(tx.codeVerifier()).hasSize(43);
    assertThat(read.returnTo()).isEqualTo("/");
  }

  @Test
  void tamperedPayload_isRejected() {
    String value = cookie.toCookie(cookie.create("/a")).getValue();
    String tampered = "x" + value.substring(1);
    assertThat(cookie.read(tampered)).isEmpty();
  }

  @Test
  void otherSecret_isRejected() {
    JwtProperties other =
        new JwtProperties("b3RoZXItc2VjcmV0LWtleS1mb3ItaW50ZWdyYXRpb24tdGVzdHMtb25seS11c2U=", 1, 1, 1);
    String value = cookie.toCookie(cookie.create("/a")).getValue();
    assertThat(new SsoTransactionCookie(other, true, Clock.fixed(now, ZoneOffset.UTC)).read(value)).isEmpty();
  }

  @Test
  void expired_isRejected() {
    String value = cookie.toCookie(cookie.create("/a")).getValue();
    SsoTransactionCookie later =
        new SsoTransactionCookie(JWT, true, Clock.fixed(now.plus(Duration.ofMinutes(11)), ZoneOffset.UTC));
    assertThat(later.read(value)).isEmpty();
  }

  @Test
  void garbage_isRejected() {
    assertThat(cookie.read("")).isEmpty();
    assertThat(cookie.read("no-dot")).isEmpty();
    assertThat(cookie.read(".sig")).isEmpty();
  }

  @Test
  void challenge_isS256OfVerifier() {
    // RFC 7636 Appendix B 예시
    assertThat(SsoTransactionCookie.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"))
        .isEqualTo("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  }

  @Test
  void expiredCookie_clearsSamePath() {
    ResponseCookie c = cookie.expired();
    assertThat(c.getPath()).isEqualTo("/api/v1/auth/sso");
    assertThat(c.getMaxAge()).isEqualTo(Duration.ZERO);
  }
}
