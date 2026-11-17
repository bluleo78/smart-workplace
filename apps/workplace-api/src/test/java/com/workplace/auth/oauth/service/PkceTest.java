package com.workplace.auth.oauth.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-1685 — PKCE S256 검증(RFC 7636) 순수 함수 단위 테스트. */
class PkceTest {

  /** RFC 7636 부록 B 의 예시 값. */
  private static final String VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  private static final String CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

  @Test
  void rfc7636AppendixB_matches() {
    assertThat(Pkce.verifyS256(VERIFIER, CHALLENGE)).isTrue();
  }

  @Test
  void oneCharDifferentVerifier_doesNotMatch() {
    String changed = VERIFIER.substring(0, VERIFIER.length() - 1) + "Y";
    assertThat(Pkce.verifyS256(changed, CHALLENGE)).isFalse();
  }

  @Test
  void oneCharDifferentChallenge_doesNotMatch() {
    String changed = CHALLENGE.substring(0, CHALLENGE.length() - 1) + "N";
    assertThat(Pkce.verifyS256(VERIFIER, changed)).isFalse();
  }

  @Test
  void verifier42Chars_isRejected() {
    // 길이 규칙(43~128자)은 해시 비교 전에 본다 — 42자는 해시가 맞든 아니든 거절.
    String shortVerifier = "a".repeat(42);
    assertThat(Pkce.verifyS256(shortVerifier, Pkce.s256(shortVerifier))).isFalse();
  }

  @Test
  void verifier129Chars_isRejected() {
    String longVerifier = "a".repeat(129);
    assertThat(Pkce.verifyS256(longVerifier, Pkce.s256(longVerifier))).isFalse();
  }

  @Test
  void verifierWithIllegalChar_isRejected() {
    String bad = "a".repeat(42) + "+";
    assertThat(Pkce.verifyS256(bad, Pkce.s256(bad))).isFalse();
  }

  @Test
  void nulls_areRejected() {
    assertThat(Pkce.verifyS256(null, CHALLENGE)).isFalse();
    assertThat(Pkce.verifyS256(VERIFIER, null)).isFalse();
  }
}
