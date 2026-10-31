package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * 노트 본문 → 평문 추출(WP-1243). WP-1240(페이지 스타일·스타일 컨테이너)·WP-1242(HTML 블록) 본문 모양마다 글자만 남는지, 마크다운·멘션·코드
 * 블록이 예전 미리보기·검색과 같게 다뤄지는지 본다.
 */
class WikiPlainTextTest {

  @Test
  void empty_for_null_and_blank() {
    assertThat(WikiPlainText.fromMarkdown(null)).isEmpty();
    assertThat(WikiPlainText.fromMarkdown(" \n\t ")).isEmpty();
    assertThat(WikiPlainText.fromMarkdownKeepingLines(null)).isEmpty();
  }

  /** WP-1240 — 페이지 스타일은 CSS 째, 스타일 컨테이너·span 은 태그만 지우고 안 글자는 남긴다. */
  @Test
  void drops_page_style_and_unwraps_styled_containers() {
    String md =
        "<style data-wp-style>\n.card{color:red}\n#x > p { margin: 0 }\n</style>\n\n"
            + "<div class=\"card\" style=\"padding:8px\">\n\n## 매출 보고\n\n"
            + "이번 달 <span class=\"badge\" style=\"color:#0a0\">좋음</span>\n\n</div>\n\n"
            + "<section class=\"wrap\">\n\n<article>\n\n- 항목 하나\n\n</article>\n\n</section>";
    String out = WikiPlainText.fromMarkdown(md);
    assertThat(out).isEqualTo("매출 보고 이번 달 좋음 항목 하나");
    assertThat(out).doesNotContain("div", "card", "style", "span", "color", "section", "<", ">");
  }

  /** 닫는 태그가 없는 스타일(앞부분만 잘라 읽은 본문)은 끝까지 지운다. */
  @Test
  void unclosed_style_is_dropped_to_the_end() {
    assertThat(WikiPlainText.fromMarkdown("앞 글\n\n<STYLE data-wp-style>\n.a{color:red}"))
        .isEqualTo("앞 글");
  }

  /** WP-1242 — HTML 블록은 펜스째 지운다(소스의 글자·태그·스크립트가 검색에 걸리지 않게). 앞뒤 글자는 남는다. */
  @Test
  void drops_html_embed_blocks_with_their_fences() {
    String md =
        "앞 문단\n\n```html-embed\n<!doctype html><html><head><title>차트</title>"
            + "<style>body{margin:0}</style></head><body><canvas id=\"c\"></canvas>"
            + "<script>new Chart(document.getElementById('c'))</script>숨은글자</body></html>\n```\n\n뒤 문단";
    assertThat(WikiPlainText.fromMarkdown(md)).isEqualTo("앞 문단 뒤 문단");
  }

  /** 소스에 백틱 3개가 있어 펜스가 더 긴 HTML 블록(웹 htmlEmbedFence), 목록 안 HTML 블록도 지운다. */
  @Test
  void drops_long_fence_and_list_nested_html_embeds() {
    String longFence = "가\n\n````html-embed\n<pre>```코드```</pre>\n<p>소스</p>\n````\n\n나";
    assertThat(WikiPlainText.fromMarkdown(longFence)).isEqualTo("가 나");
    String inList = "- 항목\n  ```html-embed\n  <b>소스</b>\n  ```\n- 다음";
    assertThat(WikiPlainText.fromMarkdown(inList)).isEqualTo("항목 다음");
  }

  /** 닫는 펜스 없이 끝난 HTML 블록(링크 미리보기가 앞 4000자만 읽은 경우)도 끝까지 지운다. */
  @Test
  void unclosed_html_embed_is_dropped_to_the_end() {
    assertThat(WikiPlainText.fromMarkdown("소개 글\n\n```html-embed\n<div>소스 앞부분")).isEqualTo("소개 글");
  }

  /** 일반 코드 블록은 펜스 줄만 빼고 내용 글자를 남긴다(예전 검색이 원문으로 코드도 찾았다). 코드 안의 html-embed 예시 줄은 HTML 블록이 아니다. */
  @Test
  void keeps_text_of_other_code_blocks() {
    assertThat(WikiPlainText.fromMarkdown("설명\n\n```java\nint total = a*b*c;\n```\n\n끝"))
        .isEqualTo("설명 int total = a*b*c; 끝");
    String example = "````markdown\n```html-embed\n<b>예시</b>\n```\n````";
    assertThat(WikiPlainText.fromMarkdown(example)).contains("예시");
  }

  /** 코드 속 꺾쇠는 HTML 이 아니다 — 인라인 코드의 <style>·<!-- 가 뒤 글자를 끝까지 지우지 않고, 코드 블록 속 태그 글자도 남는다. */
  @Test
  void html_inside_code_is_kept_as_text() {
    assertThat(WikiPlainText.fromMarkdown("`<style>` 태그를 쓴다.\n\n뒤 문단 `<!--` 주석\n\n끝 글자"))
        .isEqualTo("<style> 태그를 쓴다. 뒤 문단 <!-- 주석 끝 글자");
    assertThat(WikiPlainText.fromMarkdown("예시\n\n```html\n<script>run()</script>\n```\n\n끝"))
        .isEqualTo("예시 <script>run()</script> 끝");
  }

  /** 마크다운 표기 — 링크 미리보기(WP-895)가 지우던 것과 같다. */
  @Test
  void strips_markdown_like_the_link_preview() {
    String md =
        "# 제목\n> 인용 문장\n\n| 열1 | 열2 |\n| --- | --- |\n| 가 | 나 |\n\n---\n- [x] 끝낸 일\n"
            + "![그림](a.png) <u>밑줄</u> [링크](https://x.y) **굵게** *기울임* ~~취소~~ `코드`";
    assertThat(WikiPlainText.fromMarkdown(md))
        .isEqualTo("제목 인용 문장 열1 열2 가 나 끝낸 일 밑줄 링크 굵게 기울임 취소 코드");
  }

  /** 멘션 토큰(마크다운·표 HTML 폴백 칩·이스케이프 형태)은 숫자 id 라 지운다. */
  @Test
  void removes_mention_tokens() {
    String md =
        "<@12> 님께 <#issue:34> 와 <#page:5> 참고\n\n"
            + "| <span data-mtype=\"USER\" data-id=\"7\">&lt;@7&gt;</span> | 담당 |";
    assertThat(WikiPlainText.fromMarkdown(md)).isEqualTo("님께 와 참고 담당");
  }

  /** 비교식·엔티티 — 태그가 아닌 꺾쇠는 남기고, 엔티티는 글자로 푼다. 글자로 쓴 &lt;div&gt; 는 글자다. */
  @Test
  void keeps_comparisons_and_unescapes_entities() {
    assertThat(WikiPlainText.fromMarkdown("조건 a<b 이면\n결과 c>d, 값 &amp; 글자 &lt;div&gt;"))
        .isEqualTo("조건 a<b 이면 결과 c>d, 값 & 글자 <div>");
  }

  /** HTML 주석은 내용째 지운다. */
  @Test
  void drops_html_comments() {
    assertThat(WikiPlainText.fromMarkdown("가 <!-- 숨김 --> 나")).isEqualTo("가 나");
  }

  /** 줄 구조 유지 판(AI 요약) — 줄 안 공백은 접고 빈 줄은 하나로. */
  @Test
  void keeping_lines_variant_keeps_line_breaks() {
    String md =
        "<style data-wp-style>.a{}</style>\n\n# 회의\n\n\n첫  줄\n\n<div class=\"x\">\n\n둘째 줄\n\n</div>";
    assertThat(WikiPlainText.fromMarkdownKeepingLines(md)).isEqualTo("회의\n첫 줄\n둘째 줄");
  }
}
