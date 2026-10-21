package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** CapabilityTokens.generateUrlSafe·urlSafeLength — base64url(패딩 없음) 고정 길이 토큰과 그 길이 계산. */
class CapabilityTokensTest {

  /** 32바이트 → 43자, URL 안전 문자만, 매번 다르다(태그 구독 주소 토큰 형식, WP-715). */
  @Test
  void generateUrlSafe_isFixedLengthBase64Url() {
    String a = CapabilityTokens.generateUrlSafe(32);
    assertThat(a).matches("^[A-Za-z0-9_-]{43}$");
    assertThat(CapabilityTokens.generateUrlSafe(32)).isNotEqualTo(a);
  }

  /** 길이 계산이 실제 인코딩 길이와 같다 — 3의 배수가 아닌 바이트 수도. */
  @Test
  void urlSafeLength_matchesEncodedLength() {
    for (int bytes : new int[] {1, 2, 3, 16, 31, 32, 33}) {
      assertThat(CapabilityTokens.generateUrlSafe(bytes))
          .hasSize(CapabilityTokens.urlSafeLength(bytes));
    }
    assertThat(CapabilityTokens.urlSafeLength(32)).isEqualTo(43);
  }
}
