package com.workplace.mail.exception;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.ResourceAccessException;

/** WP-151 일시 장애 분류 — 연결·읽기 타임아웃 원인만 일시 장애, 그 외는 메일 단위 실패. */
class MailAiExceptionTest {

  @Test
  void isTransient_trueOnlyForResourceAccessCause() {
    assertThat(
            new MailAiException("t", new ResourceAccessException("read timed out")).isTransient())
        .isTrue();
    assertThat(new MailAiException("x", new RuntimeException("boom")).isTransient()).isFalse();
    assertThat(new MailAiException("x", null).isTransient()).isFalse();
  }
}
