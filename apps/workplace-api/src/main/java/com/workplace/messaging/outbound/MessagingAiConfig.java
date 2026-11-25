package com.workplace.messaging.outbound;

import com.workplace.airun.AiCall;
import com.workplace.airun.AiCallTimeouts;
import com.workplace.airun.outbound.AiAgentHttp;
import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 메시징 AI 전용 RestClient 빈 — connect 5s / read 는 상한 표 기준(ai-agent 예산 초과 보장), 무재시도.
 *
 * <p>MailAiConfig 를 미러한다.
 */
@Configuration
public class MessagingAiConfig {

  /** 분류 클라이언트의 read 상한 — 분류 실행 상한(MESSAGING_CLASSIFY) + 여유. */
  static Duration classifyReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(AiCall.MESSAGING_CLASSIFY);
  }

  /** 캐치업 클라이언트의 read 상한 — 요약 실행 상한(MESSAGING_CATCHUP) + 여유. */
  static Duration catchupReadTimeout(AiCallTimeouts timeouts) {
    return timeouts.readTimeoutFor(AiCall.MESSAGING_CATCHUP);
  }

  /**
   * 메시징 AI 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 는 {@link #classifyReadTimeout} — read timeout 은 ai-agent 의 CLI 예산을 반드시
   * 초과해야 한다.
   */
  @Bean
  public AiAgentMessagingClient aiAgentMessagingClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder =
        aiAgentHttp.restClient(
            props.baseUrl(), Duration.ofSeconds(5), classifyReadTimeout(timeouts));
    return new AiAgentMessagingClient(builder, props.internalToken());
  }

  /**
   * 캐치업 요약 클라이언트 — connect 5s / read 는 {@link #catchupReadTimeout}. 미읽은 메시지를 구조화 요약으로 변환하는 ai-agent
   * /messaging/catchup 호출.
   */
  @Bean
  public AiAgentCatchupClient aiAgentCatchupClient(
      AiAgentProperties props, AiAgentHttp aiAgentHttp, AiCallTimeouts timeouts) {
    var builder =
        aiAgentHttp.restClient(
            props.baseUrl(), Duration.ofSeconds(5), catchupReadTimeout(timeouts));
    return new AiAgentCatchupClient(builder, props.internalToken());
  }
}
