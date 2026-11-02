package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.wiki.dto.WikiPageKind;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * 노트 HTML 소스 추출·지문(WP-1290). 웹 {@code htmlScriptsHash} 와 같은 고정 예시·기대값을 쓴다 — 두 쪽이 어긋나면 공개 보기가 점검을 찾지
 * 못해 스크립트를 막는다(fail closed).
 */
class WikiHtmlScriptSourcesTest {

  /** 웹과 함께 쓰는 고정 예시 — 정렬하면 div 가 앞이고, 같은 소스 둘은 각각 센다. */
  static final List<String> FIXTURE =
      List.of(
          "<script>alert('나')</script>",
          "<div onclick=\"x()\">b</div>",
          "<script>alert('나')</script>");

  /** 고정 예시의 지문 — 웹 vitest 와 같은 값이어야 한다. */
  static final String FIXTURE_HASH =
      "20600931b3c45025f18a3e0359faef50e5ad7972b906221113af081925b10370";

  /** 고정 예시: 정렬 → 구분 글자로 잇기 → UTF-8 SHA-256 소문자 16진수. */
  @Test
  void fixture_hash_matches_web() {
    String joined = WikiHtmlScriptSources.joined(FIXTURE);
    assertThat(joined)
        .isEqualTo(
            "<div onclick=\"x()\">b</div>\n<!-- wp-html-block -->\n<script>alert('나')</script>"
                + "\n<!-- wp-html-block -->\n<script>alert('나')</script>");
    assertThat(WikiHtmlScriptSources.hash(FIXTURE)).isEqualTo(FIXTURE_HASH).hasSize(64);
    // 순서가 달라도 같은 지문.
    assertThat(WikiHtmlScriptSources.hash(List.of(FIXTURE.get(1), FIXTURE.get(0), FIXTURE.get(2))))
        .isEqualTo(FIXTURE_HASH);
  }

  /**
   * 마크다운 추출: 최상위 블록, 목록 항목 안 블록(접두를 뗀다), 스크립트 없는 블록(빠짐), 일반 ```html 코드 블록(빠짐). 소스 끝 줄바꿈은 붙이지 않고 소스
   * 안 빈 줄은 그대로다.
   */
  @Test
  void extracts_script_sources_from_markdown() {
    String md =
        "# 제목\n\n"
            + "```html-embed\n<script>\nrun()\n</script>\n\n<p>끝</p>\n```\n\n"
            + "- 항목\n"
            + "- ```html-embed\n  <div onclick=\"go()\">x</div>\n\n  <b>y</b>\n  ```\n\n"
            + "```html-embed\n<p>스크립트 없음</p>\n```\n\n"
            + "```html\n<script>notEmbed()</script>\n```\n";

    List<String> sources = WikiHtmlScriptSources.of(WikiPageKind.NOTE, md, null);

    assertThat(sources)
        .containsExactly(
            "<script>\nrun()\n</script>\n\n<p>끝</p>", "<div onclick=\"go()\">x</div>\n\n<b>y</b>");
  }

  /** 인용·CRLF 안 블록도 편집기가 보는 글자로 되살린다. */
  @Test
  void extracts_from_blockquote_and_crlf() {
    String md = "> ```html-embed\r\n> <script>a()</script>\r\n>\r\n> ```\r\n";
    assertThat(WikiHtmlScriptSources.of(WikiPageKind.NOTE, md, null))
        .containsExactly("<script>a()</script>\n");
  }

  /** HTML 문서는 원본 전체가 소스 하나(스크립트가 있을 때만). 본문 마크다운은 보지 않는다. */
  @Test
  void html_document_is_one_source() {
    String html = "<html><body><script>x()</script></body></html>";
    assertThat(WikiHtmlScriptSources.of(WikiPageKind.HTML, "```html-embed\n<script/>\n```", html))
        .containsExactly(html);
    assertThat(WikiHtmlScriptSources.of(WikiPageKind.HTML, null, "<p>no</p>")).isEmpty();
    assertThat(WikiHtmlScriptSources.of(WikiPageKind.NOTE, null, null)).isEmpty();
  }
}
