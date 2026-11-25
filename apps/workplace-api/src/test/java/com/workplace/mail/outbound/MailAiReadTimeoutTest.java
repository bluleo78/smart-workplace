package com.workplace.mail.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** 메일 AI 클라이언트의 read 상한이 메일 호출 8개의 실행 상한 표 값을 항상 넘는지 검증한다(WP-2111). */
class MailAiReadTimeoutTest {

  @Test
  void 기본값에서는_가장_긴_메일_상한_더하기_여유_150초다() {
    assertThat(MailAiConfig.readTimeout(AiCallTimeouts.defaults()))
        .isEqualTo(Duration.ofSeconds(150));
  }

  @Test
  void 메일_호출_전부를_덮는다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();
    assertThat(MailAiConfig.CALLS).hasSize(8);
    for (AiCall c : MailAiConfig.CALLS) {
      assertThat(MailAiConfig.readTimeout(t)).isGreaterThan(t.timeout(c));
    }
  }

  @Test
  void 덮어쓰면_읽기_상한도_커진다() {
    AiCallTimeouts t = new AiCallTimeouts("MAIL_REPLY_DRAFT=5m");
    assertThat(MailAiConfig.readTimeout(t)).isEqualTo(Duration.ofSeconds(330));
  }
}
