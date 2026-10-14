package com.workplace.home.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

/** WP-384 답 발췌 — 키워드가 맞은 곳 주변 300자(코드포인트), 없으면 앞 300자, 잘린 쪽에 "…". */
class ConversationExcerptTest {

  @Test
  void 짧으면_그대로_줄바꿈은_한_칸으로() {
    assertThat(HomeConversationSearchService.excerpt("첫 줄\n\n둘째 줄", List.of("둘째"), 300))
        .isEqualTo("첫 줄 둘째 줄");
    assertThat(HomeConversationSearchService.excerpt(null, List.of(), 300)).isNull();
  }

  @Test
  void 맞은_곳이_뒤에_있으면_그_주변을_보여_준다() {
    String text = "가".repeat(500) + " 고양이 폴더 " + "나".repeat(500);
    String out = HomeConversationSearchService.excerpt(text, List.of("고양이"), 300);
    assertThat(out).startsWith("…").endsWith("…").contains("고양이");
    assertThat(out.codePointCount(0, out.length())).isEqualTo(302);
  }

  @Test
  void 맞은_곳이_없으면_앞부분() {
    String out = HomeConversationSearchService.excerpt("다".repeat(400), List.of("고양이"), 300);
    assertThat(out).isEqualTo("다".repeat(300) + "…");
  }
}
