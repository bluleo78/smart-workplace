package com.workplace.home.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

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
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(90));
    return new AiAgentContextSummaryClient(builder, props.internalToken());
  }

  /**
   * 추천 질문 클라이언트(WP-139) — connect 5s / read 25s. ai-agent 상한(starter 15s·followup 20s)에 5초 여유 — 한
   * 클라이언트를 두 용도가 같이 쓰므로 긴 쪽(followup)에 맞춘다. 무재시도.
   */
  @Bean
  public AiAgentSuggestionClient aiAgentSuggestionClient(AiAgentProperties props) {
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(25));
    return new AiAgentSuggestionClient(builder, props.internalToken());
  }
}
