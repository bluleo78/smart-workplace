package com.workplace.global.util;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.CharConversionException;
import org.junit.jupiter.api.Test;

/** ExceptionCauses.classChain — 로그에 남길 원인 사슬이 클래스 이름만 담는지. */
class ExceptionCausesTest {

  /** 메시지(매개변수 값·토큰 조각 등)는 싣지 않고 클래스 이름만 잇는다(WP-1949). */
  @Test
  void 클래스_이름만_잇고_메시지는_싣지_않는다() {
    String chain =
        ExceptionCauses.classChain(
            new IllegalStateException("password=s3cret", new CharConversionException("s3cret")));
    assertThat(chain)
        .isEqualTo("java.lang.IllegalStateException <- java.io.CharConversionException");
    assertThat(chain).doesNotContain("s3cret");
  }
}
