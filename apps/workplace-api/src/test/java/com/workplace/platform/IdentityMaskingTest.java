package com.workplace.platform;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.platform.util.IdentityMasking;
import org.junit.jupiter.api.Test;

/** 신원 부분 마스킹 유틸 단위 테스트. */
class IdentityMaskingTest {

  @Test
  void maskEmailLike_email() {
    assertThat(IdentityMasking.maskEmailLike("gildong@corp.com")).isEqualTo("g***@c***.com");
  }

  @Test
  void maskEmailLike_nonEmail_degrades() {
    assertThat(IdentityMasking.maskEmailLike("operator1")).isEqualTo("o***");
  }

  @Test
  void maskEmailLike_nullOrBlank() {
    assertThat(IdentityMasking.maskEmailLike(null)).isNull();
    assertThat(IdentityMasking.maskEmailLike("")).isEqualTo("");
  }

  @Test
  void maskEmailLike_shortLocalPart() {
    assertThat(IdentityMasking.maskEmailLike("a@b.io")).isEqualTo("a***@b***.io");
  }

  @Test
  void maskName_multiChar() {
    assertThat(IdentityMasking.maskName("홍길동")).isEqualTo("홍**");
  }

  @Test
  void maskName_singleChar() {
    assertThat(IdentityMasking.maskName("김")).isEqualTo("*");
  }

  @Test
  void maskName_nullOrBlank() {
    assertThat(IdentityMasking.maskName(null)).isNull();
    assertThat(IdentityMasking.maskName("")).isEqualTo("");
  }
}
