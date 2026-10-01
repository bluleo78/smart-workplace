package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.repository.EmailMessageRepository.AnalysisContext;
import com.workplace.mail.service.MailSummaryDecider.Decision;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/** WP-149 요약 상태 판정 — 티어 × 시도 × 생략 × 요약 유무 × 새 본문 길이. */
class MailSummaryDeciderTest {

  /** 분석 컨텍스트 픽스처 — 새 본문 길이는 인용 없는 평문 본문 길이로 만든다. */
  private static AnalysisContext ctx(
      String personalSummary,
      String contentSummary,
      boolean personalAttempted,
      boolean personalSkipped,
      boolean contentAttempted,
      boolean contentSkipped,
      int len) {
    return new AnalysisContext(
        1L,
        1L,
        1L,
        true,
        "INBOX",
        true,
        false,
        "제목",
        "a@example.com",
        null,
        null,
        null,
        "x".repeat(len),
        null,
        null,
        false,
        null,
        contentSummary,
        contentAttempted,
        contentSkipped,
        false,
        personalSummary,
        personalAttempted,
        personalSkipped,
        OffsetDateTime.now());
  }

  private static AnalysisContext common(
      String content, boolean attempted, boolean skipped, int len) {
    return ctx(null, content, false, false, attempted, skipped, len);
  }

  private static AnalysisContext personal(
      String personalSummary, String content, boolean attempted, boolean skipped, int len) {
    return ctx(personalSummary, content, attempted, skipped, true, false, len);
  }

  @Test
  void common_summaryPresent_ready() {
    var o = MailSummaryDecider.decide(common("• 요약", true, false, 900), false);
    assertThat(o.decision()).isEqualTo(Decision.READY);
    assertThat(o.text()).isEqualTo("• 요약");
  }

  @Test
  void common_skippedLong_skipped() {
    assertThat(MailSummaryDecider.decide(common(null, true, true, 401), false).decision())
        .isEqualTo(Decision.SKIPPED);
  }

  @Test
  void common_skippedShort_empty() {
    assertThat(MailSummaryDecider.decide(common(null, true, true, 400), false).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void common_attemptedNoResult_empty() {
    assertThat(MailSummaryDecider.decide(common(null, true, false, 900), false).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void common_notAttempted_generate() {
    assertThat(MailSummaryDecider.decide(common(null, false, false, 900), false).decision())
        .isEqualTo(Decision.GENERATE);
  }

  @Test
  void personal_personalSummaryWins() {
    var o = MailSummaryDecider.decide(personal("• 나에게", "• 공통", true, false, 900), true);
    assertThat(o.text()).isEqualTo("• 나에게");
  }

  @Test
  void personal_fallsBackToContentSummary() {
    var o = MailSummaryDecider.decide(personal(null, "• 공통", false, false, 900), true);
    assertThat(o.decision()).isEqualTo(Decision.READY);
    assertThat(o.text()).isEqualTo("• 공통");
  }

  @Test
  void personal_skipCountsAsAttempted() {
    // 개인 요약 생략은 summarized_at 을 남기지 않는다 — 생략 표시로 판정해야 매 GET 재생성이 없다
    assertThat(MailSummaryDecider.decide(personal(null, null, false, true, 900), true).decision())
        .isEqualTo(Decision.SKIPPED);
    assertThat(MailSummaryDecider.decide(personal(null, null, false, true, 120), true).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void personal_attemptedNoResult_empty() {
    assertThat(MailSummaryDecider.decide(personal(null, null, true, false, 900), true).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void personal_notAttempted_generate_evenIfContentAttempted() {
    assertThat(MailSummaryDecider.decide(personal(null, null, false, false, 900), true).decision())
        .isEqualTo(Decision.GENERATE);
  }
}
