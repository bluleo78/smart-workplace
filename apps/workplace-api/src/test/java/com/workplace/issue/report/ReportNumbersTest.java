package com.workplace.issue.report;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 리포트 숫자 표기(WP-1486) — 개인 보고 「평균 소요」 일수 칸과 그 변화 칸 모양을 고정한다. */
class ReportNumbersTest {

  @Test
  void days_oneDecimal_nullIsDash() {
    assertThat(ReportNumbers.days(3.24)).isEqualTo("3.2일");
    assertThat(ReportNumbers.days(3.25)).isEqualTo("3.3일");
    assertThat(ReportNumbers.days(2.0)).isEqualTo("2.0일");
    assertThat(ReportNumbers.days(null)).isEqualTo("—");
  }

  @Test
  void diffDays_signsAndDash() {
    assertThat(ReportNumbers.diffDays(2.7, 3.2)).isEqualTo("−0.5일");
    assertThat(ReportNumbers.diffDays(3.5, 3.2)).isEqualTo("+0.3일");
    // 보이는 값(소수 1자리)이 같으면 0 — 3.21 과 3.24 는 둘 다 3.2일.
    assertThat(ReportNumbers.diffDays(3.21, 3.24)).isEqualTo("0일");
    assertThat(ReportNumbers.diffDays(null, 3.2)).isEqualTo("—");
    assertThat(ReportNumbers.diffDays(3.2, null)).isEqualTo("—");
  }
}
