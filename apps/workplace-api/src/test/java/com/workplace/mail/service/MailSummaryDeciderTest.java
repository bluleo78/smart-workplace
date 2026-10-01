package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.service.MailSummaryDecider.Decision;
import com.workplace.mail.service.MailSummaryDecider.State;
import org.junit.jupiter.api.Test;

/** WP-149 요약 상태 판정 — 티어 × 시도 × 생략 × 요약 유무 × 새 본문 길이. */
class MailSummaryDeciderTest {

  private static State common(String content, boolean attempted, boolean skipped, int len) {
    return new State(false, null, content, false, false, attempted, skipped, len);
  }

  private static State personal(
      String personalSummary, String content, boolean attempted, boolean skipped, int len) {
    return new State(true, personalSummary, content, attempted, skipped, true, false, len);
  }

  @Test
  void common_summaryPresent_ready() {
    var o = MailSummaryDecider.decide(common("• 요약", true, false, 900));
    assertThat(o.decision()).isEqualTo(Decision.READY);
    assertThat(o.text()).isEqualTo("• 요약");
  }

  @Test
  void common_skippedLong_skipped() {
    assertThat(MailSummaryDecider.decide(common(null, true, true, 401)).decision())
        .isEqualTo(Decision.SKIPPED);
  }

  @Test
  void common_skippedShort_empty() {
    assertThat(MailSummaryDecider.decide(common(null, true, true, 400)).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void common_attemptedNoResult_empty() {
    assertThat(MailSummaryDecider.decide(common(null, true, false, 900)).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void common_notAttempted_generate() {
    assertThat(MailSummaryDecider.decide(common(null, false, false, 900)).decision())
        .isEqualTo(Decision.GENERATE);
  }

  @Test
  void personal_personalSummaryWins() {
    var o = MailSummaryDecider.decide(personal("• 나에게", "• 공통", true, false, 900));
    assertThat(o.text()).isEqualTo("• 나에게");
  }

  @Test
  void personal_fallsBackToContentSummary() {
    var o = MailSummaryDecider.decide(personal(null, "• 공통", false, false, 900));
    assertThat(o.decision()).isEqualTo(Decision.READY);
    assertThat(o.text()).isEqualTo("• 공통");
  }

  @Test
  void personal_skipCountsAsAttempted() {
    // 개인 요약 생략은 summarized_at 을 남기지 않는다 — 생략 표시로 판정해야 매 GET 재생성이 없다
    assertThat(MailSummaryDecider.decide(personal(null, null, false, true, 900)).decision())
        .isEqualTo(Decision.SKIPPED);
    assertThat(MailSummaryDecider.decide(personal(null, null, false, true, 120)).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void personal_attemptedNoResult_empty() {
    assertThat(MailSummaryDecider.decide(personal(null, null, true, false, 900)).decision())
        .isEqualTo(Decision.EMPTY);
  }

  @Test
  void personal_notAttempted_generate_evenIfContentAttempted() {
    assertThat(MailSummaryDecider.decide(personal(null, null, false, false, 900)).decision())
        .isEqualTo(Decision.GENERATE);
  }
}
