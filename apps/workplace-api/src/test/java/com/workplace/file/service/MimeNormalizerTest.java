package com.workplace.file.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** 업로드 경계 mime 정규화 — 브라우저가 모르는 확장자(.hwp 등)를 표준 mime 으로 보정한다. */
class MimeNormalizerTest {

  @Test
  @DisplayName("octet-stream 은 확장자로 보정")
  void normalizesOctetStream() {
    assertThat(MimeNormalizer.normalize("보고서.hwp", "application/octet-stream"))
        .isEqualTo("application/x-hwp");
    assertThat(MimeNormalizer.normalize("보고서.hwpx", "application/octet-stream"))
        .isEqualTo("application/hwp+zip");
    assertThat(MimeNormalizer.normalize("index.html", "application/octet-stream"))
        .isEqualTo("text/html");
  }

  @Test
  @DisplayName("브라우저가 준 구체적 mime 은 덮어쓰지 않는다")
  void keepsSpecificBrowserMime() {
    assertThat(MimeNormalizer.normalize("a.html", "text/html")).isEqualTo("text/html");
    assertThat(MimeNormalizer.normalize("a.csv", "text/csv")).isEqualTo("text/csv");
  }

  @Test
  @DisplayName("빈 mime·미지의 확장자는 안전 폴백")
  void fallbacks() {
    assertThat(MimeNormalizer.normalize("a.hwp", null)).isEqualTo("application/x-hwp");
    assertThat(MimeNormalizer.normalize("a.bin", "application/octet-stream"))
        .isEqualTo("application/octet-stream");
    assertThat(MimeNormalizer.normalize("확장자없음", "application/octet-stream"))
        .isEqualTo("application/octet-stream");
  }

  @Test
  @DisplayName("확장자 대소문자 무시")
  void caseInsensitive() {
    assertThat(MimeNormalizer.normalize("A.HWP", "application/octet-stream"))
        .isEqualTo("application/x-hwp");
  }
}
