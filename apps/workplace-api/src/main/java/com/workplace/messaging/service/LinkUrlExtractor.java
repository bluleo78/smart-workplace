package com.workplace.messaging.service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 채팅 본문에서 링크 미리보기 대상 URL 을 뽑는다(WP-874). 웹 {@code src/lib/linkify.ts} 와 같은 경계 규칙이어야 화면에 링크로 보인 주소와
 * 미리보기 카드가 어긋나지 않는다.
 *
 * <p>규칙: {@code http://}·{@code https://}(대소문자 무관) 또는 {@code www.} 로 시작하고 바로 앞이 문자열 처음이거나 ASCII 단어
 * 문자([A-Za-z0-9_])가 아닌 토큰. URL 문자는 RFC 3986 ASCII(비예약·예약 문자·%)만 — 공백·꺾쇠·큰따옴표·비-ASCII(한글 등)에서 끝난다.
 * 끝의 {@code .,!?;:'"} 와 짝 없는 닫는 괄호 {@code )}·{@code ]} 는 문장 부호로 보고 뺀다. {@code www.} 시작은 {@code
 * https://} 를 붙인다. 접두사만 있는 토큰은 링크가 아니다.
 *
 * <p>마크다운(WP-101): {@code [글](url)} 은 주소만 보고 뽑는다 — 대괄호·괄호가 URL 문자라 {@code [https://a](https://a)} 가
 * 한 토큰으로 이어 붙지 않도록 먼저 주소로 바꿔 둔다. 끝의 강조 기호 {@code *}·{@code ~} 도 문장 부호처럼 뺀다({@code **https://a**}).
 */
public final class LinkUrlExtractor {

  /** 한 메시지에서 미리보기를 만드는 최대 URL 수. */
  public static final int MAX_PREVIEWS = 3;

  private static final String TRAILING_PUNCT = ".,!?;:'\"*~";

  /** 마크다운 링크 {@code [글](url)} — url 안 괄호 한 겹까지 허용(ChatMarkdownText 와 같은 모양). */
  private static final Pattern MD_LINK =
      Pattern.compile("\\[[^\\]\\n]*\\]\\(((?:[^()\\s]|\\([^()\\s]*\\))+)\\)");

  private LinkUrlExtractor() {}

  /** 본문에서 정규화한 URL(href)을 나온 순서대로, 중복 없이 최대 {@link #MAX_PREVIEWS} 개. */
  public static List<String> extract(String body) {
    if (body == null || body.isEmpty()) return List.of();
    // 마크다운 링크는 주소만 공백으로 감싸 남긴다 — 글 쪽 URL 과 주소가 한 토큰으로 붙지 않게.
    body = MD_LINK.matcher(body).replaceAll(m -> Matcher.quoteReplacement(" " + m.group(1) + " "));
    Set<String> out = new LinkedHashSet<>();
    int i = 0;
    int n = body.length();
    while (i < n && out.size() < MAX_PREVIEWS) {
      int prefixLen = prefixAt(body, i);
      if (prefixLen == 0 || (i > 0 && isAsciiWord(body.charAt(i - 1)))) {
        i++;
        continue;
      }
      int end = i;
      while (end < n && isUrlChar(body.charAt(end))) end++;
      String token = trimTrailing(body.substring(i, end));
      if (token.length() > prefixLen) {
        boolean www = Character.toLowerCase(body.charAt(i)) == 'w';
        out.add(www ? "https://" + token : token);
      }
      // 토큰 전체를 건너뛴다 — 토큰 안의 또 다른 www. 를 새 링크로 보지 않도록.
      i = Math.max(end, i + 1);
    }
    return new ArrayList<>(out);
  }

  /** i 에서 시작하는 링크 접두사 길이(https:// 8, http:// 7, www. 4). 아니면 0. */
  private static int prefixAt(String s, int i) {
    String rest = s.substring(i, Math.min(s.length(), i + 8)).toLowerCase(Locale.ROOT);
    if (rest.startsWith("https://")) return 8;
    if (rest.startsWith("http://")) return 7;
    if (rest.startsWith("www.")) return 4;
    return 0;
  }

  private static boolean isAsciiWord(char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
  }

  /** RFC 3986 문자(비예약 + 예약 + %). 따옴표(")·꺾쇠·공백·비-ASCII 는 포함하지 않는다. */
  private static boolean isUrlChar(char c) {
    if (isAsciiWord(c)) return true;
    return "-.~:/?#[]@!$&'()*+,;=%".indexOf(c) >= 0;
  }

  /** 끝 문장 부호와 짝 없는 닫는 괄호를 더 바뀌지 않을 때까지 뺀다. */
  static String trimTrailing(String token) {
    String t = token;
    while (!t.isEmpty()) {
      char last = t.charAt(t.length() - 1);
      if (TRAILING_PUNCT.indexOf(last) >= 0) {
        t = t.substring(0, t.length() - 1);
      } else if (last == ')' && count(t, ')') > count(t, '(')) {
        t = t.substring(0, t.length() - 1);
      } else if (last == ']' && count(t, ']') > count(t, '[')) {
        t = t.substring(0, t.length() - 1);
      } else {
        break;
      }
    }
    return t;
  }

  private static int count(String s, char c) {
    int k = 0;
    for (int i = 0; i < s.length(); i++) if (s.charAt(i) == c) k++;
    return k;
  }
}
