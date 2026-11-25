package com.workplace.wiki.outbound;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 노트 요약 전용 RestClient 빈(AiAgentDriveConfig 미러). read timeout 은 노트 요약 실행 상한(WIKI_SUMMARIZE) + 여유 —
 * 느리지만 성공한 요청을 api 가 먼저 끊지 않게 한다(WP-2111).
 */
@Configuration
public class WikiAiAgentSummaryConfig {

  /** 요약 클라이언트의 read 상한 — 노트 요약 실행 상한 + 여유. */
  static Duration readTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(AiCall.WIKI_SUMMARIZE);
  }

  @Bean
  public WikiAiAgentSummaryClient wikiAiAgentSummaryClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var restClient =
        aiAgentHttp
            .restClient(props.baseUrl(), Duration.ofSeconds(5), readTimeout(timeouts))
            .build();
    return new WikiAiAgentSummaryClient(restClient, props.internalToken());
  }
}
