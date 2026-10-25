package com.workplace.wiki.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 링크 미리보기 설명 평문(WP-895) — 노트 블록 표기·서식 기호를 지우고 공백을 접어 앞부분만. */
class WikiPreviewTextTest {

  @Test
  void strips_block_markup_images_tables_and_html() {
    String md =
        "# 제목\n> 인용 문장\n\n| 열1 | 열2 |\n| --- | --- |\n| 가 | 나 |\n\n---\n- [x] 끝낸 일\n![그림](a.png) <u>밑줄</u> [링크](https://x.y)";
    assertThat(WikiPreviewText.excerpt(md)).isEqualTo("제목 인용 문장 열1 열2 가 나 끝낸 일 밑줄 링크");
  }

  @Test
  void empty_when_blank() {
    assertThat(WikiPreviewText.excerpt(null)).isEmpty();
    assertThat(WikiPreviewText.excerpt(" \n ")).isEmpty();
    assertThat(WikiPreviewText.excerpt("![그림](a.png)")).isEmpty();
  }

  @Test
  void cuts_long_text_with_ellipsis_by_code_points() {
    String out = WikiPreviewText.excerpt("가".repeat(500));
    assertThat(out).hasSize(WikiPreviewText.MAX_LENGTH).endsWith("…");
    assertThat(WikiPreviewText.excerpt("가".repeat(WikiPreviewText.MAX_LENGTH))).doesNotEndWith("…");
  }

  @Test
  void keeps_comparisons_and_unescapes_entities() {
    assertThat(WikiPreviewText.excerpt("조건 a<b 이면\n결과 c>d, 값 &amp; 비율 &lt;5%"))
        .isEqualTo("조건 a<b 이면 결과 c>d, 값 & 비율 <5%");
  }
}
