package com.workplace.fileai.security;

import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTML 원본 바이트를 문자열로 읽는다(WP-1262). 늘 UTF-8 로 읽으면 UTF-16 문서의 {@code <script>} 를 못 보고 SKIPPED 로 빠져
 * 웹(브라우저가 인코딩을 알아서 읽는다)과 판정이 어긋난다.
 *
 * <p>판정 순서: ① BOM(UTF-8 / UTF-16LE / UTF-16BE) ② 앞 {@value #SNIFF_BYTES}바이트를 ASCII 로 보고 {@code
 * <meta charset=…>} 또는 {@code content="…charset=…"} ③ 그 밖·지원하지 않는 이름은 UTF-8. 브라우저의 전체 인코딩 탐지 알고리즘은
 * 아니다 — 스크립트 판정용 거름이라 흔한 경우만 맞춘다.
 */
public final class HtmlCharset {

  private HtmlCharset() {}

  /** meta 선언을 찾을 앞부분 길이 — HTML 표준의 prescan 범위와 같다. */
  static final int SNIFF_BYTES = 1024;

  /**
   * {@code charset=이름} — meta charset 속성과 http-equiv content 안의 꼴을 함께 잡는다. 이름에 쓰이는 글자만 받는다(선형 정규식).
   */
  private static final Pattern META_CHARSET =
      Pattern.compile(
          "<meta[^>]*?charset\\s*=\\s*[\"']?\\s*([A-Za-z0-9_.:\\-]+)", Pattern.CASE_INSENSITIVE);

  /** 바이트를 문자열로 디코드한다. 깨진 바이트는 대체 문자로 읽혀도 태그 판정에는 지장이 없다. */
  public static String decode(byte[] bytes) {
    if (bytes == null || bytes.length == 0) return "";
    // ① BOM — 있으면 그 인코딩으로, BOM 자체는 떼고 읽는다.
    if (startsWith(bytes, 0xEF, 0xBB, 0xBF)) {
      return new String(bytes, 3, bytes.length - 3, StandardCharsets.UTF_8);
    }
    if (startsWith(bytes, 0xFF, 0xFE)) {
      return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16LE);
    }
    if (startsWith(bytes, 0xFE, 0xFF)) {
      return new String(bytes, 2, bytes.length - 2, StandardCharsets.UTF_16BE);
    }
    // ② meta 선언 — 앞부분을 ASCII 로 본다(ASCII 호환 인코딩이면 태그 글자가 그대로 보인다).
    Charset declared = sniffMeta(bytes);
    return new String(bytes, declared != null ? declared : StandardCharsets.UTF_8);
  }

  /**
   * 앞 {@value #SNIFF_BYTES}바이트에서 meta charset 을 찾아 지원되는 Charset 이면 돌려준다. UTF-16 선언은 무시한다(ASCII 로
   * 보였다면 실제로는 아니다).
   */
  static Charset sniffMeta(byte[] bytes) {
    String head =
        new String(bytes, 0, Math.min(bytes.length, SNIFF_BYTES), StandardCharsets.US_ASCII);
    Matcher m = META_CHARSET.matcher(head);
    if (!m.find()) return null;
    String name = m.group(1).trim();
    try {
      Charset cs = Charset.forName(name);
      // 앞부분이 ASCII 로 읽혔으니 ASCII 비호환 인코딩(UTF-16·UTF-32·EBCDIC 등)일 수 없다 — 브라우저도 이런 선언은 무시하고 스크립트를
      // 실행한다. 그대로 따르면 서버만 문서를 엉뚱하게 읽어 <script> 를 못 보고 SKIPPED(점검 회피)가 되므로 UTF-8 로 읽는다.
      return isAsciiCompatible(cs) ? cs : StandardCharsets.UTF_8;
    } catch (IllegalArgumentException e) {
      // 잘못된 이름(IllegalCharsetNameException)·지원하지 않는 이름(UnsupportedCharsetException) — 기본값으로.
      return null;
    }
  }

  /** 태그·속성 판정에 쓰이는 ASCII 글자가 그 인코딩에서도 US-ASCII 와 같은 바이트인지. */
  private static boolean isAsciiCompatible(Charset cs) {
    if (!cs.canEncode()) return false;
    return Arrays.equals(ASCII_PROBE.getBytes(cs), ASCII_PROBE.getBytes(StandardCharsets.US_ASCII));
  }

  /** ASCII 호환 판정용 표본 — 스크립트 판정 정규식이 보는 글자들. */
  private static final String ASCII_PROBE = "<script onload=\"javascript:x()\"/> AZaz09';";

  private static boolean startsWith(byte[] bytes, int... prefix) {
    if (bytes.length < prefix.length) return false;
    for (int i = 0; i < prefix.length; i++) {
      if ((bytes[i] & 0xFF) != prefix[i]) return false;
    }
    return true;
  }
}
