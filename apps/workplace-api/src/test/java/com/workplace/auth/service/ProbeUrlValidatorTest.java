package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.exception.UnsafeProbeUrlException;
import org.junit.jupiter.api.Test;

class ProbeUrlValidatorTest {

  @Test
  void https_는_허용() {
    assertThatCode(() -> ProbeUrlValidator.validate("https://api.openai.com/v1"))
        .doesNotThrowAnyException();
  }

  @Test
  void http_사설망_loopback_은_허용() {
    assertThatCode(() -> ProbeUrlValidator.validate("http://localhost:11434/v1"))
        .doesNotThrowAnyException();
    assertThatCode(() -> ProbeUrlValidator.validate("http://127.0.0.1:11434/v1"))
        .doesNotThrowAnyException();
  }

  @Test
  void http_사설_IP대역은_허용() {
    assertThatCode(() -> ProbeUrlValidator.validate("http://192.168.1.10:8080/v1"))
        .doesNotThrowAnyException();
    assertThatCode(() -> ProbeUrlValidator.validate("http://10.0.0.5/v1"))
        .doesNotThrowAnyException();
  }

  @Test
  void http_공인_호스트는_거부() {
    assertThatThrownBy(() -> ProbeUrlValidator.validate("http://api.openai.com/v1"))
        .isInstanceOf(UnsafeProbeUrlException.class);
  }

  @Test
  void 잘못된_URL_형식은_거부() {
    assertThatThrownBy(() -> ProbeUrlValidator.validate("not-a-url"))
        .isInstanceOf(UnsafeProbeUrlException.class);
  }

  @Test
  void 알수없는_스킴은_거부() {
    assertThatThrownBy(() -> ProbeUrlValidator.validate("ftp://example.com"))
        .isInstanceOf(UnsafeProbeUrlException.class);
  }
}
