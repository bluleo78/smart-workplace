package com.workplace.messaging.service;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * 링크 미리보기용 HTML 메타 추출(WP-874). og:* → twitter:* → {@code <title>}·{@code meta[name=description]}
 * 순으로 채운다. og:image 상대 경로는 페이지 주소 기준으로 절대화하고 http(s) 만 받는다. 문자열은 공백을 접고 길이 상한으로 자른다(저장·카드 표시용).
 */
public final class OpenGraphParser {

  static final int MAX_TITLE = 300;
  static final int MAX_DESCRIPTION = 500;
  static final int MAX_SITE = 100;
  static final int MAX_IMAGE_URL = 2048;

  /** 추출 결과. title 이 null 이면 미리보기를 만들지 않는다. */
  public record OgMeta(String title, String description, String siteName, String imageUrl) {}

  private OpenGraphParser() {}

  /**
   * HTML 바이트를 파싱한다.
   *
   * @param charset 응답 헤더의 charset(없으면 null — jsoup 이 BOM·meta charset 으로 판단, 기본 UTF-8)
   * @param baseUri 리다이렉트 뒤 최종 페이지 주소(상대 경로 절대화 기준)
   */
  public static OgMeta parse(byte[] html, String charset, String baseUri) {
    Document doc;
    try {
      doc = Jsoup.parse(new ByteArrayInputStream(html), safeCharset(charset), baseUri);
    } catch (IOException | IllegalArgumentException e) {
      return new OgMeta(null, null, null, null);
    }
    String title = first(doc, "og:title", "twitter:title");
    if (title == null) title = clean(doc.title());
    String description = first(doc, "og:description", "twitter:description");
    if (description == null) description = metaContent(doc, "meta[name=description]");
    String site = first(doc, "og:site_name");
    String image = imageUrl(doc);
    return new OgMeta(
        cut(title, MAX_TITLE), cut(description, MAX_DESCRIPTION), cut(site, MAX_SITE), image);
  }

  /** 지원하지 않는 charset 이름이면 null 로 두고 jsoup 이 판단하게 한다. */
  private static String safeCharset(String charset) {
    if (charset == null) return null;
    try {
      return java.nio.charset.Charset.isSupported(charset) ? charset : null;
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  /** og:image(:secure_url·:url) → twitter:image(:src) 중 처음 나오는 http(s) 절대 주소. */
  private static String imageUrl(Document doc) {
    for (String key :
        new String[] {
          "og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src"
        }) {
      Element el = metaElement(doc, key);
      if (el == null) continue;
      String abs = el.absUrl("content");
      if (abs.isEmpty()) continue;
      String lower = abs.toLowerCase(Locale.ROOT);
      if ((lower.startsWith("http://") || lower.startsWith("https://"))
          && abs.length() <= MAX_IMAGE_URL) {
        return abs;
      }
    }
    return null;
  }

  /** property 또는 name 이 key 인 meta 들 중 처음 내용 있는 값. */
  private static String first(Document doc, String... keys) {
    for (String key : keys) {
      Element el = metaElement(doc, key);
      if (el == null) continue;
      String v = clean(el.attr("content"));
      if (v != null) return v;
    }
    return null;
  }

  /** og 는 property, twitter 는 name 이 표준이지만 사이트마다 섞어 쓴다 — 둘 다 본다. */
  private static Element metaElement(Document doc, String key) {
    for (Element el : doc.select("meta[property], meta[name]")) {
      boolean match =
          key.equalsIgnoreCase(el.attr("property").trim())
              || key.equalsIgnoreCase(el.attr("name").trim());
      if (match && !el.attr("content").isBlank()) return el;
    }
    return null;
  }

  private static String metaContent(Document doc, String selector) {
    Element el = doc.selectFirst(selector);
    return el == null ? null : clean(el.attr("content"));
  }

  /** 공백(줄바꿈 포함)을 한 칸으로 접고 앞뒤를 다듬는다. 비면 null. */
  private static String clean(String s) {
    if (s == null) return null;
    String v = s.replaceAll("\\s+", " ").trim();
    return v.isEmpty() ? null : v;
  }

  /** 코드 포인트 경계를 지키며 max 자로 자른다. */
  static String cut(String s, int max) {
    if (s == null || s.length() <= max) return s;
    int end = max;
    if (Character.isHighSurrogate(s.charAt(end - 1))) end--;
    return s.substring(0, end);
  }
}
