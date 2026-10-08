package com.workplace.messaging.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 메시징 AI 전용 RestClient 빈 — connect 5s / read 90s(ai-agent 예산 초과 보장), 무재시도.
 *
 * <p>MailAiConfig 를 미러한다.
 */
@Configuration
public class MessagingAiConfig {

  /**
   * 메시징 AI 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 90s — read timeout 은 ai-agent 의 CLI 예산을 반드시 초과해야 한다.
   */
  @Bean
  public AiAgentMessagingClient aiAgentMessagingClient(AiAgentProperties props) {
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(90));
    return new AiAgentMessagingClient(builder, props.internalToken());
  }

  /**
   * 캐치업 요약 클라이언트 — 메시징 분류와 동일한 타임아웃 정책(connect 5s / read 90s). 미읽은 메시지를 구조화 요약으로 변환하는 ai-agent
   * /messaging/catchup 호출.
   */
  @Bean
  public AiAgentCatchupClient aiAgentCatchupClient(AiAgentProperties props) {
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(90));
    return new AiAgentCatchupClient(builder, props.internalToken());
  }
}
