package com.workplace.fileai.security;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Attribute;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;

/**
 * HTML 에서 보안 판단에 필요한 신호만 모은 「스크립트 요지」(WP-1262). AI 에 문서 전체를 넘기지 않고 스크립트·이벤트 속성·javascript:
 * 주소·폼·프레임·바깥 주소만 섹션별 텍스트로 만든다 — 본문 글자·이미지 데이터는 판단에 쓸모가 없고 토큰만 먹는다. 바깥 주소는 실행·전송·표시 자원·링크로 나눠
 * 싣는다(WP-1283) — 글꼴 CSS 나 뉴스 링크를 코드 실행과 같은 무게로 보지 않게.
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

  /** 속성 값 안의 공백·줄바꿈 묶음({@link #oneLine}) — 요소마다 정규식을 새로 만들지 않게. */
  private static final Pattern WHITESPACE = Pattern.compile("\\s+");

  /** 바깥 주소에서 코드를 불러와 실행하는 요소 — 주소 속성 이름. */
  private static final Map<String, String> EXEC_ATTRS =
      Map.of("script", "src", "iframe", "src", "frame", "src", "embed", "src", "object", "data");

  /**
   * 코드를 실행하지 않는 {@code <link rel>} 값 — 스타일·글꼴·아이콘 같은 표시 자원(WP-1283). 그 밖의 rel(modulepreload 등)은 코드로
   * 본다.
   */
  private static final Set<String> RESOURCE_LINK_RELS =
      Set.of(
          "stylesheet",
          "preload",
          "prefetch",
          "preconnect",
          "dns-prefetch",
          "icon",
          "shortcut",
          "apple-touch-icon",
          "manifest",
          "alternate",
          "canonical");

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
    // 바깥 주소는 하는 일로 나눠 모은다(WP-1283) — 「바깥 주소가 있다」만으로는 위험을 가를 수 없어서다.
    // 중복은 빼고 처음 나온 순서를 지킨다.
    Set<String> extExec = new LinkedHashSet<>(); // 코드를 불러와 실행(스크립트·프레임)
    Set<String> extSend = new LinkedHashSet<>(); // 입력을 보내는 곳(form action)
    Set<String> extResource = new LinkedHashSet<>(); // 표시 자원 — CSS·글꼴·이미지·미디어(실행 안 됨)
    Set<String> embedded = new LinkedHashSet<>(); // 문서에 넣어 둔 data: 자원 — 바깥 요청이 없다
    Set<String> links = new LinkedHashSet<>(); // 사용자가 눌러야 이동하는 링크

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

      classifyUrls(el, tag, extExec, extSend, extResource, embedded, links);
    }
    forms.addAll(formInputs);
    frames.addAll(metaRefresh);
    frames.addAll(bases);

    StringBuilder sb = new StringBuilder();
    appendSection(sb, "[스크립트]", scripts);
    appendSection(sb, "[이벤트 속성]", events);
    appendSection(sb, "[javascript: 주소]", jsUrls);
    appendSection(sb, "[폼·입력]", forms);
    appendSection(sb, "[프레임·이동]", frames);
    appendSection(sb, "[바깥 주소 — 코드를 불러와 실행]", new ArrayList<>(extExec));
    appendSection(sb, "[바깥 주소 — 입력을 보냄]", new ArrayList<>(extSend));
    appendSection(sb, "[바깥 주소 — 표시 자원(CSS·글꼴·이미지, 실행 안 됨)]", new ArrayList<>(extResource));
    appendSection(sb, "[문서에 넣어 둔 자원(data:, 바깥 요청 없음)]", new ArrayList<>(embedded));
    appendSection(sb, "[링크 — 사용자가 눌러야 이동]", new ArrayList<>(links));
    String text = sb.toString().strip();

    if (text.length() <= MAX_CHARS) {
      return new Result(text, false);
    }
    return new Result(
        text.substring(0, HEAD_CHARS) + ELISION + text.substring(text.length() - TAIL_CHARS), true);
  }

  /**
   * 요소의 주소 속성을 하는 일로 나눠 담는다(WP-1283). 스크립트·프레임은 실행, form action 은 전송, 이미지·스타일·글꼴은 표시 자원, {@code
   * <a>} 는 누르기 전에는 아무 일도 하지 않는 링크다(target 을 함께 적는다). 표시 자원의 {@code data:} 는 바깥 요청이 없으므로 따로 둔다 — 실행
   * 요소의 {@code data:} 는 코드라 실행 쪽에 남긴다. 상대 경로는 같은 문서 묶음이라 싣지 않는다.
   */
  private static void classifyUrls(
      Element el,
      String tag,
      Set<String> extExec,
      Set<String> extSend,
      Set<String> extResource,
      Set<String> embedded,
      Set<String> links) {
    String execAttr = EXEC_ATTRS.get(tag);
    if (execAttr != null) {
      addIfOutside(el.attr(execAttr), "<" + tag + "> ", extExec);
      return;
    }
    switch (tag) {
      case "form" -> addIfOutside(el.attr("action"), "", extSend);
      // 단추의 formaction 은 form action 을 덮어써 입력을 그쪽으로 보낸다 — 전송 대상에 함께 싣는다.
      case "button" -> addIfOutside(el.attr("formaction"), "<button formaction> ", extSend);
      case "img", "source", "video", "audio", "track", "input" -> {
        addIfOutside(el.attr("src"), "<" + tag + "> ", extResource, embedded);
        if (tag.equals("input"))
          addIfOutside(el.attr("formaction"), "<input formaction> ", extSend);
        if (tag.equals("video"))
          addIfOutside(el.attr("poster"), "<video poster> ", extResource, embedded);
      }
      case "link" -> {
        // rel 은 문서가 정한 값이라 토큰을 공백 하나로 다시 이어 붙인다 — 줄바꿈으로 가짜 섹션 머리를 끼워 넣지 못하게.
        String rel = oneLine(el.attr("rel")).toLowerCase(Locale.ROOT);
        boolean resource =
            !rel.isEmpty() && Arrays.stream(rel.split(" ")).allMatch(RESOURCE_LINK_RELS::contains);
        String label = "<link rel=" + rel + "> ";
        if (resource) addIfOutside(el.attr("href"), label, extResource, embedded);
        else addIfOutside(el.attr("href"), label, extExec);
      }
      case "a", "area" -> {
        // data: 링크도 문서 밖 문서를 여는 것이라 싣는다(앞부분만).
        String href = oneLine(el.attr("href"));
        if (isOutside(href) || href.regionMatches(true, 0, "data:", 0, 5)) {
          String target = oneLine(el.attr("target"));
          links.add(trimDataUri(href) + (target.isEmpty() ? "" : " (target=" + target + ")"));
        }
      }
      default -> {}
    }
  }

  /** 바깥 주소든 data: 든 한 곳({@code sink})에 담는다 — 실행·전송 요소는 data: 도 같은 무게라서. */
  private static void addIfOutside(String raw, String label, Set<String> sink) {
    addIfOutside(raw, label, sink, sink);
  }

  /** 바깥 주소(http·https·//)면 {@code outside} 에, data: 면 {@code dataSink} 에 담는다. */
  private static void addIfOutside(
      String raw, String label, Set<String> outside, Set<String> dataSink) {
    String url = oneLine(raw);
    if (url.regionMatches(true, 0, "data:", 0, 5)) {
      dataSink.add(label + trimDataUri(url));
    } else if (isOutside(url)) {
      outside.add(label + url);
    }
  }

  /** 문서가 정한 속성 값을 한 줄로 — 안쪽 공백·줄바꿈을 공백 하나로 접어 요지의 줄·섹션 구조를 흐트리지 못하게 한다. */
  private static String oneLine(String raw) {
    return raw == null ? "" : WHITESPACE.matcher(raw.strip()).replaceAll(" ");
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

  /** 문서 밖 주소인지 — http(s)·프로토콜 상대(//)만 본다. 상대 경로는 같은 문서 묶음, data: 는 문서 안 자원이라 뺀다. */
  private static boolean isOutside(String url) {
    String u = url.toLowerCase(Locale.ROOT);
    return u.startsWith("http://") || u.startsWith("https://") || u.startsWith("//");
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
