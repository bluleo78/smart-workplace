package com.workplace.home.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 홈 채팅 전용 AiAgentChatClient Bean — JDK HttpClient 기반 SSE 스트리밍 (B2).
 *
 * <p>RestClient 기반 블로킹 호출에서 JDK HttpClient ofLines 스트리밍으로 전환했다. timeout 은 클라이언트 내부에서 관리한다.
 */
@Configuration
public class HomeChatConfig {

  /** AiAgentChatClient Bean — props 에서 baseUrl/internalToken 을 가져온다. */
  @Bean
  public AiAgentChatClient aiAgentChatClient(AiAgentProperties props) {
    return new AiAgentChatClient(props);
  }

  /**
   * 누적 요약 클라이언트(WP-232) — connect 5s / read 90s(ai-agent 요약 예산 60s 를 반드시 초과), 무재시도.
   * MessagingAiConfig 미러.
   */
  @Bean
  public AiAgentContextSummaryClient aiAgentContextSummaryClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(90));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var builder = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory);
    return new AiAgentContextSummaryClient(builder, props.internalToken());
  }
}
