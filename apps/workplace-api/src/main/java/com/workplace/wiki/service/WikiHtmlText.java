package com.workplace.wiki.service;

import java.util.Set;
import java.util.regex.Pattern;
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.jsoup.nodes.Element;
import org.jsoup.nodes.Node;
import org.jsoup.nodes.TextNode;
import org.jsoup.select.NodeTraversor;
import org.jsoup.select.NodeVisitor;

/**
 * HTML 문서 원본 → 사람이 읽는 본문 글자(WP-1307). HTML 문서 페이지의 {@code wiki_page.body} 로 저장해 검색 색인·AI 요약·링크
 * 미리보기·MCP 읽기가 태그·스크립트 대신 글자를 보게 한다.
 *
 * <ul>
 *   <li>{@code <script>}·{@code <style>}·{@code <template>}·{@code <noscript>}·{@code <svg>} 안 글자는
 *       화면 글자가 아니라 뺀다.
 *   <li>블록 요소(문단·제목·목록·표 행 등)와 {@code <br>} 는 줄을 바꾼다 — AI 요약이 문단 경계를 쓰게.
 *   <li>{@code <title>} 은 본문 앞 줄로 둔다(문서 제목으로 찾을 수 있게).
 * </ul>
 *
 * 줄 안 공백은 하나로, 빈 줄은 접는다.
 */
public final class WikiHtmlText {

  /** 글자를 뽑지 않는 요소 — 스크립트·스타일·템플릿 등 화면 글자가 아닌 것. */
  private static final Set<String> SKIP =
      Set.of("script", "style", "template", "noscript", "svg", "head", "iframe", "object");

  /** 앞뒤로 줄을 바꾸는 블록 요소. */
  private static final Set<String> BLOCKS =
      Set.of(
          "p",
          "div",
          "section",
          "article",
          "header",
          "footer",
          "main",
          "aside",
          "nav",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "li",
          "ul",
          "ol",
          "dl",
          "dt",
          "dd",
          "tr",
          "table",
          "blockquote",
          "pre",
          "figure",
          "figcaption",
          "hr",
          "details",
          "summary",
          "form",
          "fieldset",
          "address",
          "caption",
          "thead",
          "tbody",
          "tfoot");

  /** 줄 안 공백(줄바꿈 없는 공백·NBSP 포함) — 줄마다 하나로 접는다. 저장마다 수만 줄을 돌므로 한 번만 컴파일한다. */
  private static final Pattern SPACES = Pattern.compile("[\\s\\u00A0]+");

  private WikiHtmlText() {}

  /** 뽑은 글자 → 한 줄 검색 평문(공백 하나로 접음). 이미 평문이라 마크다운 정리는 하지 않는다. */
  public static String oneLine(String text) {
    return text == null ? "" : SPACES.matcher(text).replaceAll(" ").strip();
  }

  /** 원본 HTML → 줄 구조를 남긴 본문 글자. null·빈 원본은 빈 문자열. */
  public static String extract(String html) {
    if (html == null || html.isBlank()) {
      return "";
    }
    Document doc = Jsoup.parse(html);
    StringBuilder out = new StringBuilder();
    String title = doc.title();
    if (!title.isBlank()) {
      out.append(title).append('\n');
    }
    NodeTraversor.traverse(new Collector(out), doc.body());
    return normalize(out.toString());
  }

  /** 줄 안 공백은 하나로, 줄 앞뒤 공백·빈 줄은 접는다. */
  private static String normalize(String s) {
    StringBuilder out = new StringBuilder(s.length());
    for (String line : s.split("\n")) {
      String folded = SPACES.matcher(line).replaceAll(" ").strip();
      if (!folded.isEmpty()) {
        out.append(folded).append('\n');
      }
    }
    return out.toString().strip();
  }

  /** 본문을 깊이 우선으로 돌며 글자를 모은다 — 건너뛸 요소의 하위는 모으지 않는다. */
  private static final class Collector implements NodeVisitor {
    private final StringBuilder out;
    // 건너뛸 요소 안에 들어간 깊이 — 0 일 때만 글자를 모은다.
    private int skipping;

    Collector(StringBuilder out) {
      this.out = out;
    }

    @Override
    public void head(Node node, int depth) {
      if (node instanceof Element el) {
        String tag = el.normalName();
        if (SKIP.contains(tag)) {
          skipping++;
        } else if (skipping == 0 && (BLOCKS.contains(tag) || "br".equals(tag))) {
          out.append('\n');
        }
      } else if (skipping == 0 && node instanceof TextNode text) {
        out.append(text.getWholeText());
      }
    }

    @Override
    public void tail(Node node, int depth) {
      if (node instanceof Element el) {
        String tag = el.normalName();
        if (SKIP.contains(tag)) {
          skipping--;
        } else if (skipping == 0 && BLOCKS.contains(tag)) {
          out.append('\n');
        } else if (skipping == 0 && ("td".equals(tag) || "th".equals(tag))) {
          // 표 칸 사이 — 붙어 읽히지 않게 공백을 둔다.
          out.append(' ');
        }
      }
    }
  }
}
