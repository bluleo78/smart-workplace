package com.workplace.home.outbound;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** AiAgentPriorityClient 빈 등록 — IssueAiConfig 와 동일 ai-agent 인스턴스/토큰(AiAgentProperties) 재사용. */
@Configuration
public class PriorityAiConfig {

  /**
   * 우선순위 분류 클라이언트의 read 상한 — 분류 실행 상한(HOME_PRIORITY_CLASSIFY) + 여유. 분류 스케줄러의 회차 시간 예산도 이 값으로
   * 센다(WP-2111).
   */
  public static Duration readTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(AiCall.HOME_PRIORITY_CLASSIFY);
  }

  /**
   * 우선순위 분류 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 는 상한 표 기준 — read timeout 은 ai-agent 의 LLM 예산을 반드시 초과해야 한다(IssueAiConfig
   * 미러).
   */
  @Bean
  public AiAgentPriorityClient aiAgentPriorityClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder =
        aiAgentHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), readTimeout(timeouts));
    return new AiAgentPriorityClient(builder, props.internalToken());
  }
}
