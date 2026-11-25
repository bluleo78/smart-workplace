package com.workplace.issue.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** 이슈 AI 클라이언트(일반·리포트)의 read 상한이 실행 상한 표 값을 항상 넘는지 검증한다(WP-2111). */
class IssueAiReadTimeoutTest {

  @Test
  void 기본값에서는_일반_210초_리포트_210초다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();
    // 일반 클라이언트는 업무 프로필(180초)이 가장 길어 180 + 30.
    assertThat(IssueAiConfig.readTimeout(t)).isEqualTo(Duration.ofSeconds(210));
    assertThat(IssueAiConfig.reportReadTimeout(t)).isEqualTo(Duration.ofSeconds(210));
    assertThat(IssueAiConfig.readTimeout(t)).isGreaterThan(t.timeout(AiCall.WORK_PROFILE));
  }

  @Test
  void 업무_프로필을_덮어쓰면_일반_클라이언트_읽기_상한만_커진다() {
    // 업무 프로필 덮어쓰기 최대는 8분(WorkProfileService.STALE_PENDING 10분 − 여유, WP-2111)이라 그 안의 값으로 본다.
    AiCallTimeouts t = new AiCallTimeouts("WORK_PROFILE=7m");
    assertThat(IssueAiConfig.readTimeout(t)).isEqualTo(Duration.ofSeconds(450));
    assertThat(IssueAiConfig.reportReadTimeout(t)).isEqualTo(Duration.ofSeconds(210));
  }

  @Test
  void 리포트를_덮어쓰면_리포트_클라이언트_읽기_상한만_커진다() {
    AiCallTimeouts t = new AiCallTimeouts("PERSONAL_REPORT=5m");
    assertThat(IssueAiConfig.reportReadTimeout(t)).isEqualTo(Duration.ofSeconds(330));
    assertThat(IssueAiConfig.readTimeout(t)).isEqualTo(Duration.ofSeconds(210));
  }
}
