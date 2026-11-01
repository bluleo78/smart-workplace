package com.workplace.fileai.security;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * HTML 에서 보안 판단에 필요한 신호만 모은 「스크립트 요지」(WP-1262). AI 에 문서 전체를 넘기지 않고 스크립트·이벤트 속성·javascript:
 * 주소·폼·프레임·외부 주소만 섹션별 텍스트로 만든다 — 본문 글자·이미지 데이터는 판단에 쓸모가 없고 토큰만 먹는다.
 *
 * <p>상한: 전체가 {@value #MAX_CHARS}자를 넘으면 앞 {@value #HEAD_CHARS}자 + {@link #ELISION} + 뒤 {@value
 * #TAIL_CHARS}자로 줄이고 {@code truncated=true}. {@code data:} URI 는 앞 {@value #DATA_URI_KEEP}자 + … 만
 * 남긴다.
 */
public final class ScriptDigest {

  private ScriptDigest() {}

  /** 요지 결과 — 본문과 잘렸는지. */
  public record Result(String text, boolean truncated) {}

  static final int MAX_CHARS = 60_000;
  static final int HEAD_CHARS = 40_000;
  static final int TAIL_CHARS = 20_000;
  static final String ELISION = "\n…(중략)…\n";
  static final int DATA_URI_KEEP = 64;

  /** 외부 주소를 모을 요소·속성 쌍. */
  private static final String[][] URL_ATTRS = {
    {"script", "src"},
    {"img", "src"},
    {"iframe", "src"},
    {"frame", "src"},
    {"embed", "src"},
    {"object", "data"},
    {"source", "src"},
    {"link", "href"},
    {"form", "action"},
    {"a", "href"},
    {"base", "href"}
  };

  /**
   * HTML 의 스크립트 요지를 만든다. 비어 있는 섹션은 싣지 않는다.
   *
   * @param html 원본 HTML(깨진 문서도 jsoup 이 관대하게 읽는다)
   */
  public static Result build(String html) {
    Document doc = Jsoup.parse(html == null ? "" : html);

    List<String> scripts = new ArrayList<>();
    List<String> events = new ArrayList<>();
    List<String> jsUrls = new ArrayList<>();
    List<String> forms = new ArrayList<>();
    List<String> formInputs = new ArrayList<>();
    List<String> frames = new ArrayList<>();
    List<String> metaRefresh = new ArrayList<>();
    List<String> bases = new ArrayList<>();
    // [외부 주소] — URL_ATTRS 쌍 순서대로 묶어 모은 뒤 이어 붙인다(쌍 안은 문서 순서)
    List<List<String>> externalByPair = new ArrayList<>();
    for (int i = 0; i < URL_ATTRS.length; i++) externalByPair.add(new ArrayList<>());

    // 문서를 한 번만 훑으며 태그·속성별로 섹션 후보를 나눠 담는다(문서 순서).
    for (Element el : doc.getAllElements()) {
      String tag = el.normalName();

      // [스크립트] — 외부 스크립트는 주소만, 인라인은 본문 그대로
      if (tag.equals("script")) {
        String src = el.attr("src").trim();
        if (!src.isEmpty()) {
          scripts.add("외부: " + trimDataUri(src));
        } else if (!el.data().isBlank()) {
          scripts.add(el.data().strip());
        }
      }

      // [이벤트 속성]·[javascript: 주소] — 모든 요소의 속성
      for (Attribute a : el.attributes()) {
        String key = a.getKey().toLowerCase(Locale.ROOT);
        String value = a.getValue();
        if (key.startsWith("on") && key.length() > 2) {
          events.add("<" + el.tagName() + "> " + key + "=" + trimDataUri(value));
        } else if (value.strip().toLowerCase(Locale.ROOT).startsWith("javascript:")) {
          jsUrls.add("<" + el.tagName() + "> " + key + "=" + value.strip());
        }
      }

      // [폼·입력] — 자격 증명을 어디로 보내는지(action)와 어떤 칸을 받는지(type·name)
      switch (tag) {
        case "form" ->
            forms.add(
                "<form> action="
                    + trimDataUri(el.attr("action"))
                    + (el.hasAttr("method") ? " method=" + el.attr("method") : ""));
        case "input", "textarea", "select" ->
            formInputs.add(
                "<" + el.tagName() + "> type=" + el.attr("type") + " name=" + el.attr("name"));
        case "iframe", "frame", "embed", "object" -> {
          // [프레임·이동] — 다른 문서를 끼우거나 자동으로 넘기는 것
          String src = el.hasAttr("src") ? el.attr("src") : el.attr("data");
          frames.add("<" + el.tagName() + "> " + trimDataUri(src));
        }
        case "meta" -> {
          if (el.hasAttr("http-equiv")
              && "refresh".equalsIgnoreCase(el.attr("http-equiv").trim())) {
            metaRefresh.add("<meta refresh> " + trimDataUri(el.attr("content")));
          }
        }
        default -> {}
      }
      if (tag.equals("base") && el.hasAttr("href")) {
        bases.add("<base> " + trimDataUri(el.attr("href")));
      }

      for (int i = 0; i < URL_ATTRS.length; i++) {
        if (tag.equals(URL_ATTRS[i][0]) && el.hasAttr(URL_ATTRS[i][1])) {
          String url = el.attr(URL_ATTRS[i][1]).trim();
          if (isExternal(url)) externalByPair.get(i).add(trimDataUri(url));
        }
      }
    }
    forms.addAll(formInputs);
    frames.addAll(metaRefresh);
    frames.addAll(bases);
    // 중복 제거, 처음 나온 순서
    Set<String> external = new LinkedHashSet<>();
    externalByPair.forEach(external::addAll);

    StringBuilder sb = new StringBuilder();
    appendSection(sb, "[스크립트]", scripts);
    appendSection(sb, "[이벤트 속성]", events);
    appendSection(sb, "[javascript: 주소]", jsUrls);
    appendSection(sb, "[폼·입력]", forms);
    appendSection(sb, "[프레임·이동]", frames);
    appendSection(sb, "[외부 주소]", new ArrayList<>(external));
    String text = sb.toString().strip();

    if (text.length() <= MAX_CHARS) {
      return new Result(text, false);
    }
    return new Result(
        text.substring(0, HEAD_CHARS) + ELISION + text.substring(text.length() - TAIL_CHARS), true);
  }

  /** 섹션 머리와 줄들을 붙인다 — 비었으면 건너뛴다. */
  private static void appendSection(StringBuilder sb, String title, List<String> lines) {
    if (lines.isEmpty()) return;
    if (!sb.isEmpty()) sb.append("\n\n");
    sb.append(title);
    for (String line : lines) {
      sb.append('\n').append(line);
    }
  }

  /** 문서 밖 주소인지 — http(s)·프로토콜 상대(//)·data: 만 본다(상대 경로는 같은 문서 묶음이라 뺀다). */
  private static boolean isExternal(String url) {
    String u = url.toLowerCase(Locale.ROOT);
    return u.startsWith("http://")
        || u.startsWith("https://")
        || u.startsWith("//")
        || u.startsWith("data:");
  }

  /** {@code data:} URI 는 앞 {@value #DATA_URI_KEEP}자 + … 만 남긴다 — 내장 이미지·스크립트가 요지를 채우지 않게. */
  static String trimDataUri(String value) {
    if (value == null) return "";
    String v = value.strip();
    if (v.regionMatches(true, 0, "data:", 0, 5) && v.length() > DATA_URI_KEEP) {
      return v.substring(0, DATA_URI_KEEP) + "…";
    }
    return v;
  }
}
