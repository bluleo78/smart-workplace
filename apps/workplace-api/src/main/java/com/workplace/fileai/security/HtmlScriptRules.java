package com.workplace.fileai.security;

import com.workplace.file.service.MimeNormalizer;
import java.util.Locale;
import java.util.Set;
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

  /** 속성 값의 {@code javascript:} 주소. */
  private static final Pattern JS_URL =
      Pattern.compile("=\\s*[\"']?\\s*javascript:", Pattern.CASE_INSENSITIVE);

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
        || JS_URL.matcher(html).find();
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
