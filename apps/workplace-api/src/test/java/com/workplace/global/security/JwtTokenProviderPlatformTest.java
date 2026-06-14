package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Base64;
import org.junit.jupiter.api.Test;

/** JWT platform(운영자) 클레임 발급/조회 순수 단위 테스트(Spring/DB 없음). */
class JwtTokenProviderPlatformTest {

  private JwtTokenProvider newProvider() {
    // 256bit(32byte) 이상 시크릿을 Base64 로 인코딩해 직접 구성한다.
    String secret =
        Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes());
    return new JwtTokenProvider(new JwtProperties(secret, 3_600_000L, 86_400_000L));
  }

  @Test
  void platformAccessToken_hasPlatformClaim_noTenant() {
    JwtTokenProvider provider = newProvider();
    // 플랫폼 access 토큰은 platform=true, tenant 없음이어야 한다.
    String token = provider.generatePlatformAccessToken(42L, "admin");

    assertThat(provider.isPlatformToken(token)).isTrue();
    assertThat(provider.getTenantIdFromToken(token)).isNull();
    assertThat(provider.getUserIdFromToken(token)).isEqualTo(42L);
    assertThat(provider.validateAccessToken(token)).isTrue();
  }

  @Test
  void normalAccessToken_isNotPlatform() {
    JwtTokenProvider provider = newProvider();
    // 일반 테넌트 토큰은 platform 토큰이 아니어야 한다.
    String token = provider.generateAccessToken(42L, "alice", 1L);

    assertThat(provider.isPlatformToken(token)).isFalse();
  }

  @Test
  void platformRefreshToken_validAndPlatform() {
    JwtTokenProvider provider = newProvider();
    String token = provider.generatePlatformRefreshToken(42L);

    assertThat(provider.validateRefreshToken(token)).isTrue();
    assertThat(provider.isPlatformToken(token)).isTrue();
  }

  @Test
  void malformedToken_isNotPlatform_noException() {
    JwtTokenProvider provider = newProvider();
    // 손상된 임의 문자열은 예외 없이 false 를 반환해야 한다.
    assertThat(provider.isPlatformToken("not-a-real-token")).isFalse();
  }
}
