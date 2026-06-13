package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Base64;
import org.junit.jupiter.api.Test;

/** JWT active-tenant 클레임 생성/검증 순수 단위 테스트(Spring/DB 없음). */
class JwtTokenProviderTenantTest {

  private JwtTokenProvider newProvider() {
    // 256bit(32byte) 이상 시크릿을 Base64 로 인코딩해 직접 구성한다.
    String secret =
        Base64.getEncoder()
            .encodeToString("0123456789abcdef0123456789abcdef".getBytes());
    return new JwtTokenProvider(new JwtProperties(secret, 3_600_000L, 86_400_000L));
  }

  @Test
  void accessToken_withTenant_carriesTenantClaim() {
    JwtTokenProvider provider = newProvider();
    String token = provider.generateAccessToken(42L, "alice", 7L);

    assertThat(provider.validateAccessToken(token)).isTrue();
    assertThat(provider.getUserIdFromToken(token)).isEqualTo(42L);
    assertThat(provider.getTenantIdFromToken(token)).isEqualTo(7L);
  }

  @Test
  void accessToken_withoutTenant_hasNullTenantClaim() {
    JwtTokenProvider provider = newProvider();
    // 2-arg 오버로드(pre-auth 토큰)는 tenant 클레임이 없어야 한다.
    String token = provider.generateAccessToken(42L, "alice");

    assertThat(provider.validateAccessToken(token)).isTrue();
    assertThat(provider.getUserIdFromToken(token)).isEqualTo(42L);
    assertThat(provider.getTenantIdFromToken(token)).isNull();
  }

  @Test
  void refreshToken_withTenant_carriesTenantClaim() {
    JwtTokenProvider provider = newProvider();
    String token = provider.generateRefreshToken(42L, 7L);

    assertThat(provider.validateRefreshToken(token)).isTrue();
    assertThat(provider.getTenantIdFromToken(token)).isEqualTo(7L);
  }
}
