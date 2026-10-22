package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Base64;
import org.junit.jupiter.api.Test;

/**
 * JWT 의 세 조각이 정규 base64url 이 아니면 거절한다(WP-825) — 순수 단위 테스트(Spring/DB 없음).
 *
 * <p>HS384 서명(48바이트)은 base64url 64자인데, 끝에 글자 1개를 더 붙인 65자는 디코더가 남는 한 글자를 버려 같은 48바이트로 읽혀 서명 검증을
 * 통과했다 — 같은 토큰이 서로 다른 문자열 여러 개로 인증됐다(RFC 7515 의 엄격한 base64url 위반, 서명 위조는 아님).
 */
class JwtTokenProviderStrictEncodingTest {

  private final JwtTokenProvider provider =
      new JwtTokenProvider(
          new JwtProperties(
              // 48바이트 키 — jjwt 가 키 길이로 HS384 를 골라 서명이 base64url 64자(운영과 같음)가 된다. 32바이트면
              // HS256(43자)이라
              // 1자를 더해도 길이가 4의 배수가 돼 다른 바이트로 읽히므로 이 결함이 드러나지 않는다.
              Base64.getEncoder()
                  .encodeToString("0123456789abcdef0123456789abcdef0123456789abcdef".getBytes()),
              3_600_000L,
              86_400_000L,
              5L));

  @Test
  void 원본_토큰은_통과한다() {
    String token = provider.generateAccessToken(42L, "alice", 7L);
    assertThat(token.substring(token.lastIndexOf('.') + 1)).hasSize(64); // HS384
    assertThat(provider.validateAccessToken(token)).isTrue();
    assertThat(provider.accessTokenExpEpochSeconds(token)).isNotNull();
  }

  @Test
  void 서명_끝에_글자_1개를_더_붙이면_거절한다() {
    String token = provider.generateAccessToken(42L, "alice", 7L);
    for (String extra : new String[] {"x", "A", "Z", "0", "-", "_"}) {
      assertThat(provider.validateAccessToken(token + extra)).as("+" + extra).isFalse();
      assertThat(provider.validateToken(token + extra)).as("+" + extra).isFalse();
    }
  }

  @Test
  void refresh_토큰도_같은_규칙() {
    String token = provider.generateRefreshToken(42L, 7L);
    assertThat(provider.validateRefreshToken(token)).isTrue();
    assertThat(provider.validateRefreshToken(token + "x")).isFalse();
  }

  @Test
  void 헤더나_본문_조각에_패딩이나_글자를_덧붙여도_거절한다() {
    String token = provider.generateAccessToken(42L, "alice", 7L);
    String[] parts = token.split("\\.");
    assertThat(provider.validateAccessToken(parts[0] + "=." + parts[1] + "." + parts[2])).isFalse();
    assertThat(provider.validateAccessToken(parts[0] + "." + parts[1] + "x." + parts[2])).isFalse();
  }
}
