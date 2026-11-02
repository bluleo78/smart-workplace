package com.workplace.fileai.security;

import com.workplace.file.service.MimeNormalizer;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * HTML 파일·스크립트 판정 규칙(WP-1262). 웹 {@code htmlHasScripts}·{@code canonicalMime}/{@code isGenericMime}
 * 과 같은 규칙을 Java 로 옮긴 것이다 — 두 쪽이 같은 예시 JSON({@code htmlHasScripts.cases.json})으로 시험돼 어긋나지 않는다.
 *
 * <p>엄밀한 파서가 아니다. 스크립트 없는 문서를 AI 점검에서 빼려는 거름이라 드문 거짓 양성은 점검 1회가 늘 뿐이다. 정규식은 백트래킹이 선형인 꼴만 쓴다(수 MB·신뢰
 * 불가 입력). Java {@code \s} 는 ASCII 공백만 보고 JS 는 유니코드 공백도 보지만, 태그 안 속성 구분에 쓰이는 공백은 ASCII 라 실제 차이는 없다.
 */
public final class HtmlScriptRules {

  private HtmlScriptRules() {}

  /** {@code <script>} 요소 — 뒤에 공백·{@code >}·{@code /} 가 와야 한다({@code <scripts>} 제외). */
  private static final Pattern SCRIPT_TAG =
      Pattern.compile("<script[\\s>/]", Pattern.CASE_INSENSITIVE);

  /** 태그 안 인라인 이벤트 속성(onclick= 등). {@code [^<>]*} 로 태그 경계를 넘지 않는다. */
  private static final Pattern EVENT_ATTR =
      Pattern.compile("<[a-z][^<>]*\\son[a-z]+\\s*=", Pattern.CASE_INSENSITIVE);

  /** 속성 값의 {@code javascript:}·{@code vbscript:} 주소 — {@link #decodeUrlChars} 로 푼 글자에 쓴다. */
  private static final Pattern JS_URL =
      Pattern.compile("=\\s*[\"']?\\s*(?:java|vb)script:", Pattern.CASE_INSENSITIVE);

  /** 하위 프레임(WP-1290) — srcdoc·data: 문서 안에서 스크립트가 돌 수 있다. */
  private static final Pattern FRAME_TAG =
      Pattern.compile("<(?:iframe|frame|object|embed)[\\s>/]", Pattern.CASE_INSENSITIVE);

  /** 숫자 문자 참조({@code &#106;}·{@code &#x6a;}, 끝 {@code ;} 는 없어도 된다). */
  private static final Pattern NUMERIC_REF =
      Pattern.compile("&#(x[0-9a-f]+|[0-9]+);?", Pattern.CASE_INSENSITIVE);

  /** 주소를 가릴 때 쓰는 이름 참조. */
  private static final Pattern NAMED_REF =
      Pattern.compile("&(tab|newline|colon);", Pattern.CASE_INSENSITIVE);

  /** 풀어 볼 필요가 있는 문서 — 웹 decodeUrlChars 의 거름과 같다. */
  private static final Pattern DECODE_NEEDED =
      Pattern.compile("script|&#|&(?:colon|tab|newline);", Pattern.CASE_INSENSITIVE);

  private static final Pattern URL_WHITESPACE = Pattern.compile("[\\t\\n\\r]");

  /** 형식을 알려 주지 않는 범용 mime — 이때만 파일명 확장자로 HTML 을 고른다. */
  private static final Set<String> GENERIC_MIMES =
      Set.of(
          "application/octet-stream",
          "binary/octet-stream",
          "application/force-download",
          "application/x-download",
          "application/unknown");

  /** 스크립트가 든 HTML 인지 — 웹 {@code htmlHasScripts} 와 같다. */
  public static boolean hasScripts(String html) {
    if (html == null || html.isEmpty()) return false;
    return SCRIPT_TAG.matcher(html).find()
        || EVENT_ATTR.matcher(html).find()
        || FRAME_TAG.matcher(html).find()
        || JS_URL.matcher(decodeUrlChars(html)).find();
  }

  /**
   * 주소 판정 전에 브라우저가 푸는 것을 푼다(WP-1290) — 숫자 문자 참조, {@code &Tab;}·{@code &NewLine;}·{@code &colon;},
   * 그리고 주소 안 탭·줄바꿈(지운다). 웹 {@code decodeUrlChars} 와 같다.
   */
  private static String decodeUrlChars(String html) {
    // 가린 주소가 될 수 없는 문서(「script」 글자·문자 참조가 없음)는 그대로 — 수 MB 문서를 매번 세 번 다시 쓰지 않게.
    if (!DECODE_NEEDED.matcher(html).find()) return html;
    String decoded =
        NUMERIC_REF
            .matcher(html)
            .replaceAll(
                m -> {
                  String code = m.group(1);
                  long n;
                  try {
                    n =
                        code.charAt(0) == 'x' || code.charAt(0) == 'X'
                            ? Long.parseLong(code.substring(1), 16)
                            : Long.parseLong(code);
                  } catch (NumberFormatException e) {
                    return Matcher.quoteReplacement(m.group());
                  }
                  return n > 0 && n <= 0x10FFFF
                      ? Matcher.quoteReplacement(Character.toString((int) n))
                      : Matcher.quoteReplacement(m.group());
                });
    decoded =
        NAMED_REF
            .matcher(decoded)
            .replaceAll(
                m ->
                    switch (m.group(1).toLowerCase(Locale.ROOT)) {
                      case "tab" -> "\t";
                      case "newline" -> "\n";
                      default -> ":";
                    });
    return URL_WHITESPACE.matcher(decoded).replaceAll("");
  }

  /**
   * HTML 파일인지. 정규화 mime 이 {@code text/html} 이거나, mime 이 비었거나 범용이면서 파일명이 {@code .html}/{@code .htm}
   * 으로 끝나면 참.
   */
  public static boolean isHtml(String mime, String filename) {
    String base = MimeNormalizer.baseMime(mime);
    if ("text/html".equals(base)) return true;
    if (!base.isEmpty() && !GENERIC_MIMES.contains(base)) return false;
    if (filename == null) return false;
    String name = filename.trim().toLowerCase(Locale.ROOT);
    return name.endsWith(".html") || name.endsWith(".htm");
  }
}
