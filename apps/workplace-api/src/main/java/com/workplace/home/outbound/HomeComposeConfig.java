package com.workplace.home.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 홈 컴포즈 전용 AiAgentComposeClient Bean — JDK HttpClient 기반 SSE 스트리밍 (B2).
 *
 * <p>RestClient 기반 블로킹 호출에서 JDK HttpClient ofLines 스트리밍으로 전환했다. timeout 은 클라이언트 내부에서 관리한다.
 */
@Configuration
public class HomeComposeConfig {

  /** AiAgentComposeClient Bean — props 에서 baseUrl/internalToken 을 가져온다. */
  @Bean
  public AiAgentComposeClient aiAgentComposeClient(AiAgentProperties props) {
    return new AiAgentComposeClient(props);
  }
}
