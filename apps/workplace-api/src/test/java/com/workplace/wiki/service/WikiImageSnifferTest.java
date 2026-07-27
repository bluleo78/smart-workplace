package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** WikiImageSniffer 순수 단위 테스트 — 스프링 컨텍스트 불필요. */
class WikiImageSnifferTest {

  @Test
  void PNG_시그니처를_인식한다() {
    byte[] png =
        new byte[] {(byte) 0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0, 0, 0, 0, 0};
    assertThat(WikiImageSniffer.detect(png)).contains("image/png");
  }

  @Test
  void JPEG_시그니처를_인식한다() {
    byte[] jpeg =
        new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xE0, 0, 0, 0, 0, 0, 0, 0, 0};
    assertThat(WikiImageSniffer.detect(jpeg)).contains("image/jpeg");
  }

  @Test
  void GIF87a_시그니처를_인식한다() {
    byte[] gif = "GIF87a\0\0\0\0\0\0".getBytes(StandardCharsets.US_ASCII);
    assertThat(WikiImageSniffer.detect(gif)).contains("image/gif");
  }

  @Test
  void GIF89a_시그니처를_인식한다() {
    byte[] gif = "GIF89a\0\0\0\0\0\0".getBytes(StandardCharsets.US_ASCII);
    assertThat(WikiImageSniffer.detect(gif)).contains("image/gif");
  }

  @Test
  void WebP_시그니처를_인식한다() {
    byte[] webp = "RIFF\0\0\0\0WEBP".getBytes(StandardCharsets.US_ASCII);
    assertThat(WikiImageSniffer.detect(webp)).contains("image/webp");
  }

  @Test
  void SVG_는_거부한다() {
    byte[] svg =
        "<svg xmlns=\"http://www.w3.org/2000/svg\"><script/></svg>"
            .getBytes(StandardCharsets.UTF_8);
    assertThat(WikiImageSniffer.detect(svg)).isEmpty();
  }

  @Test
  void PNG_를_사칭한_HTML_은_거부한다() {
    byte[] html =
        "<html><body><script>alert(1)</script></body></html>".getBytes(StandardCharsets.UTF_8);
    assertThat(WikiImageSniffer.detect(html)).isEmpty();
  }

  @Test
  void 헤더가_12바이트_미만이면_거부한다() {
    byte[] tooShort = new byte[] {(byte) 0x89, 'P', 'N', 'G'};
    assertThat(WikiImageSniffer.detect(tooShort)).isEmpty();
  }

  @Test
  void null_입력은_거부한다() {
    assertThat(WikiImageSniffer.detect(null)).isEmpty();
  }
}
