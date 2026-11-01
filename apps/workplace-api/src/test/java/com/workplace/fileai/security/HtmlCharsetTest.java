package com.workplace.fileai.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** HTML 원본 인코딩 판정(WP-1262) — BOM 우선, 그다음 앞부분 meta charset, 그 밖은 UTF-8. */
class HtmlCharsetTest {

  private static byte[] withPrefix(byte[] prefix, byte[] body) {
    byte[] out = new byte[prefix.length + body.length];
    System.arraycopy(prefix, 0, out, 0, prefix.length);
    System.arraycopy(body, 0, out, prefix.length, body.length);
    return out;
  }

  /** UTF-16LE BOM 문서의 스크립트를 본다 — UTF-8 로 읽으면 글자 사이에 NUL 이 끼어 놓친다. */
  @Test
  void decode_whenUtf16LeBom_seesScripts() {
    String html = "<html><body><script>alert(1)</script></body></html>";
    byte[] bytes =
        withPrefix(new byte[] {(byte) 0xFF, (byte) 0xFE}, html.getBytes(StandardCharsets.UTF_16LE));

    assertThat(HtmlScriptRules.hasScripts(new String(bytes, StandardCharsets.UTF_8))).isFalse();
    assertThat(HtmlCharset.decode(bytes)).isEqualTo(html);
    assertThat(HtmlScriptRules.hasScripts(HtmlCharset.decode(bytes))).isTrue();
  }

  /** UTF-16BE BOM 도 같다. */
  @Test
  void decode_whenUtf16BeBom_decodesBigEndian() {
    String html = "<p onclick=\"x()\">가</p>";
    byte[] bytes =
        withPrefix(new byte[] {(byte) 0xFE, (byte) 0xFF}, html.getBytes(StandardCharsets.UTF_16BE));

    assertThat(HtmlCharset.decode(bytes)).isEqualTo(html);
  }

  /** UTF-8 BOM 은 떼고 읽는다. */
  @Test
  void decode_whenUtf8Bom_stripsBom() {
    byte[] bytes =
        withPrefix(
            new byte[] {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF},
            "<p>안녕</p>".getBytes(StandardCharsets.UTF_8));

    assertThat(HtmlCharset.decode(bytes)).isEqualTo("<p>안녕</p>");
  }

  /** BOM 이 없으면 앞부분 meta charset(euc-kr)으로 읽어 한글이 그대로 나온다. */
  @Test
  void decode_whenMetaEucKr_usesDeclaredCharset() {
    Charset eucKr = Charset.forName("EUC-KR");
    String html = "<html><head><meta charset=\"euc-kr\"></head><body>한글<script>1</script></body>";
    byte[] bytes = html.getBytes(eucKr);

    assertThat(HtmlCharset.decode(bytes)).isEqualTo(html);
  }

  /** http-equiv content 안의 charset 도 본다. */
  @Test
  void decode_whenHttpEquivContentCharset_usesDeclaredCharset() {
    Charset eucKr = Charset.forName("EUC-KR");
    String html =
        "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=EUC-KR\"><p>가나</p>";

    assertThat(HtmlCharset.decode(html.getBytes(eucKr))).isEqualTo(html);
  }

  /**
   * ASCII 비호환 인코딩(utf-32·IBM037)을 선언해도 따르지 않고 UTF-8 로 읽는다 — 브라우저는 이런 선언을 무시하고 스크립트를 실행하는데 서버만 엉뚱하게
   * 읽으면 SKIPPED 로 점검을 피할 수 있다.
   */
  @Test
  void decode_whenMetaDeclaresAsciiIncompatibleCharset_ignoresItAndSeesScripts() {
    for (String name : new String[] {"utf-32", "IBM037", "cp1047"}) {
      String html = "<meta charset=\"" + name + "\"><script>steal()</script>";
      byte[] bytes = html.getBytes(StandardCharsets.UTF_8);

      assertThat(HtmlScriptRules.hasScripts(HtmlCharset.decode(bytes))).as(name).isTrue();
      assertThat(HtmlCharset.decode(bytes)).as(name).isEqualTo(html);
    }
  }

  /** 모르는 이름·선언 없음은 UTF-8. */
  @Test
  void decode_whenUnknownOrNoDeclaration_fallsBackToUtf8() {
    String unknown = "<meta charset=\"x-nope-123\"><p>안녕</p>";
    String none = "<p>안녕</p>";

    assertThat(HtmlCharset.decode(unknown.getBytes(StandardCharsets.UTF_8))).isEqualTo(unknown);
    assertThat(HtmlCharset.decode(none.getBytes(StandardCharsets.UTF_8))).isEqualTo(none);
    assertThat(HtmlCharset.decode(new byte[0])).isEmpty();
  }
}
