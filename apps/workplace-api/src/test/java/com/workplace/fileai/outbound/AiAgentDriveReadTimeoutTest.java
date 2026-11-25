package com.workplace.fileai.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.AiCallTimeouts;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** 드라이브 AI 클라이언트의 read 상한 — 요약·보안 검사 실행 상한 + 여유와 기존 200초 중 큰 값(WP-2111). */
class AiAgentDriveReadTimeoutTest {

  @Test
  void 기본값에서는_기존_200초를_유지한다() {
    assertThat(AiAgentDriveConfig.readTimeout(AiCallTimeouts.defaults()))
        .isEqualTo(Duration.ofSeconds(200));
  }

  @Test
  void 보안_검사를_8분까지_덮어써도_읽기_상한이_그보다_길다() {
    AiCallTimeouts t = new AiCallTimeouts("DRIVE_SECURITY_CHECK=8m");
    assertThat(AiAgentDriveConfig.readTimeout(t)).isEqualTo(Duration.ofSeconds(510));
  }
}
