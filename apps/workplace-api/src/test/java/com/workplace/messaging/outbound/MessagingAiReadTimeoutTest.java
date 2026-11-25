package com.workplace.messaging.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** 메시징 AI 클라이언트(분류·캐치업)의 read 상한이 실행 상한 표 값을 항상 넘는지 검증한다(WP-2111). */
class MessagingAiReadTimeoutTest {

  @Test
  void 기본값에서는_두_클라이언트_모두_90초다() {
    AiCallTimeouts t = AiCallTimeouts.defaults();
    assertThat(MessagingAiConfig.classifyReadTimeout(t)).isEqualTo(Duration.ofSeconds(90));
    assertThat(MessagingAiConfig.catchupReadTimeout(t)).isEqualTo(Duration.ofSeconds(90));
    assertThat(MessagingAiConfig.classifyReadTimeout(t))
        .isGreaterThan(t.timeout(AiCall.MESSAGING_CLASSIFY));
  }

  @Test
  void 덮어쓰면_해당_클라이언트_읽기_상한만_커진다() {
    AiCallTimeouts t = new AiCallTimeouts("MESSAGING_CATCHUP=5m");
    assertThat(MessagingAiConfig.catchupReadTimeout(t)).isEqualTo(Duration.ofSeconds(330));
    assertThat(MessagingAiConfig.classifyReadTimeout(t)).isEqualTo(Duration.ofSeconds(90));
  }
}
