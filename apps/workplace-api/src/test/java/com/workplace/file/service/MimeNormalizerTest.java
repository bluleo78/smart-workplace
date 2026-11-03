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
  @DisplayName("빈 문자열·공백 mime 은 미지 확장자에서 octet-stream 으로 폴백(빈 Content-Type 방지)")
  void blankMimeFallsBackToOctetStream() {
    assertThat(MimeNormalizer.normalize("a.unknownext", "")).isEqualTo("application/octet-stream");
    assertThat(MimeNormalizer.normalize("a.unknownext", "  "))
        .isEqualTo("application/octet-stream");
    assertThat(MimeNormalizer.normalize("a.unknownext", null))
        .isEqualTo("application/octet-stream");
  }

  @Test
  @DisplayName("확장자 대소문자 무시")
  void caseInsensitive() {
    assertThat(MimeNormalizer.normalize("A.HWP", "application/octet-stream"))
        .isEqualTo("application/x-hwp");
  }

  /** WP-250: 브라우저가 빈 type·octet-stream 으로 보내기 쉬운 이미지 확장자 — 새 업로드에서 image/* 로 보정한다. */
  @Test
  @DisplayName("HEIC·HEIF·TIFF·BMP 는 빈 type·octet-stream 일 때 이미지 mime 으로 보정")
  void normalizesImageExtensions() {
    assertThat(MimeNormalizer.normalize("IMG_1.HEIC", "")).isEqualTo("image/heic");
    assertThat(MimeNormalizer.normalize("a.heif", "application/octet-stream"))
        .isEqualTo("image/heif");
    assertThat(MimeNormalizer.normalize("scan.tif", null)).isEqualTo("image/tiff");
    assertThat(MimeNormalizer.normalize("scan.TIFF", "application/octet-stream"))
        .isEqualTo("image/tiff");
    assertThat(MimeNormalizer.normalize("a.bmp", "")).isEqualTo("image/bmp");
    // 브라우저가 구체적 mime 을 주면 그대로 신뢰한다.
    assertThat(MimeNormalizer.normalize("a.heic", "image/heic")).isEqualTo("image/heic");
  }

  @Test
  @DisplayName("텍스트 파일 MIME 은 확장자 표대로(html·svg 포함), 표 밖은 text/plain (WP-421·WP-1323)")
  void textMimeOfFollowsExtensionTable() {
    assertThat(MimeNormalizer.textMimeOf("노트.MD")).isEqualTo("text/markdown");
    assertThat(MimeNormalizer.textMimeOf("a.txt")).isEqualTo("text/plain");
    assertThat(MimeNormalizer.textMimeOf("a.csv")).isEqualTo("text/csv");
    assertThat(MimeNormalizer.textMimeOf("a.json")).isEqualTo("application/json");
    assertThat(MimeNormalizer.textMimeOf("a.html")).isEqualTo("text/html");
    assertThat(MimeNormalizer.textMimeOf("a.HTM")).isEqualTo("text/html");
    assertThat(MimeNormalizer.textMimeOf("a.svg")).isEqualTo("image/svg+xml");
    assertThat(MimeNormalizer.textMimeOf("a.py")).isEqualTo("text/plain");
    assertThat(MimeNormalizer.isAllowedTextMime("text/html")).isTrue();
    assertThat(MimeNormalizer.isAllowedTextMime("application/pdf")).isFalse();
    assertThat(MimeNormalizer.isAllowedTextMime(null)).isFalse();
    assertThat(MimeNormalizer.textMimeOf("README")).isEqualTo("text/plain");
    assertThat(MimeNormalizer.textMimeOf(null)).isEqualTo("text/plain");
  }

  @Test
  @DisplayName("스테이징 텍스트는 html·svg·xml 을 text/plain 으로 둔다 — 첨부 원본 경로엔 CSP sandbox 가 없다 (WP-1323)")
  void inertTextMimeOfKeepsActiveFormatsPlain() {
    assertThat(MimeNormalizer.inertTextMimeOf("a.html")).isEqualTo("text/plain");
    assertThat(MimeNormalizer.inertTextMimeOf("a.svg")).isEqualTo("text/plain");
    assertThat(MimeNormalizer.inertTextMimeOf("a.xml")).isEqualTo("text/plain");
    assertThat(MimeNormalizer.inertTextMimeOf("a.md")).isEqualTo("text/markdown");
    assertThat(MimeNormalizer.inertTextMimeOf("a.yaml")).isEqualTo("application/x-yaml");
  }
}
