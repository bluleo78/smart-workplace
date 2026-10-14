package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** WP-383 판정 5: 메일 진입점의 메모리 질의 = 제목 + 요약 앞 200자, 둘 다 비면 null(고정 + 최신). */
class MailAiMemoryQueryTest {

  @Test
  void 제목과_요약을_이어_붙인다() {
    assertThat(MailAiService.memoryQuery("정산 자료 요청", "5월 정산 자료를 금요일까지"))
        .isEqualTo("정산 자료 요청 5월 정산 자료를 금요일까지");
    assertThat(MailAiService.memoryQuery("제목만", null)).isEqualTo("제목만");
  }

  @Test
  void 둘_다_비면_null() {
    assertThat(MailAiService.memoryQuery(null, null)).isNull();
    assertThat(MailAiService.memoryQuery("  ", "")).isNull();
  }

  @Test
  void 앞_200자만_쓴다() {
    assertThat(MailAiService.memoryQuery("가".repeat(150), "나".repeat(150))).hasSize(200);
  }
}
