package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * WP-2111: 같은 메일 분석을 기다리는 SingleFlight 대기는 리더의 최악(분석 호출 읽기 상한)보다 길어야 한다 — 상한을 덮어써도 기다리는 쪽이 먼저 포기해
 * 같은 메일을 두 번 부르지 않게.
 */
class MailAnalysisSingleFlightWaitTest {

  @Test
  void 기본값에서_대기는_분석_읽기_상한에_여유를_더한_값이다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();
    // 분석 상한 120초 + 읽기 여유 30초 + 대기 여유 30초
    assertThat(MailAnalysisService.singleFlightWait(t)).isEqualTo(Duration.ofSeconds(180));
  }

  @Test
  void 분석_상한을_최대로_덮어써도_대기가_리더보다_길다() {
    AiCallTimeouts t =
        new AiCallTimeouts(
            "MAIL_ANALYZE_PERSONAL="
                + AiCall.MAIL_ANALYZE_PERSONAL.maxOverride().toSeconds()
                + "s");
    assertThat(MailAnalysisService.singleFlightWait(t))
        .isGreaterThan(t.readTimeoutFor(AiCall.MAIL_ANALYZE_CONTENT, AiCall.MAIL_ANALYZE_PERSONAL));
  }
}
