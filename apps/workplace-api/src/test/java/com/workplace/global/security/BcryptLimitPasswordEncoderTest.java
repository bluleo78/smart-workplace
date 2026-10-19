package com.workplace.global.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** bcrypt 72바이트 한도를 한국어 안내로 드러내는 인코더(WP-497) 단위 테스트. */
class BcryptLimitPasswordEncoderTest {

  private final BcryptLimitPasswordEncoder encoder = new BcryptLimitPasswordEncoder();

  @Test
  void encodes_and_matches_up_to_72_bytes() {
    String pw = "a".repeat(72);
    String hash = encoder.encode(pw);
    assertThat(encoder.matches(pw, hash)).isTrue();
    assertThat(encoder.matches("b".repeat(72), hash)).isFalse();
  }

  @Test
  void encode_over_72_bytes_throws_korean_message() {
    // 한글은 한 글자에 3바이트라 25자(75바이트)부터 막힌다.
    assertThatThrownBy(() -> encoder.encode("가".repeat(25)))
        .isInstanceOf(PasswordTooLongException.class)
        .hasMessageContaining("72바이트");
  }

  @Test
  void matches_over_72_bytes_is_false_not_exception() {
    // 저장된 해시는 72바이트 이하로만 만들어지므로 더 긴 입력은 언제나 불일치다(로그인·공유 링크 비밀번호 확인).
    String hash = encoder.encode("Password123");
    assertThat(encoder.matches("a".repeat(100), hash)).isFalse();
  }
}
