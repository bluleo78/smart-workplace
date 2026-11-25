package com.workplace.wiki.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.airun.AiCallTimeouts;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** 노트 요약 클라이언트의 read 상한 — WIKI_SUMMARIZE 실행 상한 + 여유(WP-2111). */
class WikiAiAgentSummaryConfigTest {

  @Test
  void 기본값은_90초다() {
    assertThat(WikiAiAgentSummaryConfig.readTimeout(AiCallTimeouts.defaults()))
        .isEqualTo(Duration.ofSeconds(90));
  }

  @Test
  void 요약_상한을_5분으로_덮어쓰면_330초다() {
    assertThat(WikiAiAgentSummaryConfig.readTimeout(new AiCallTimeouts("WIKI_SUMMARIZE=5m")))
        .isEqualTo(Duration.ofSeconds(330));
  }
}
