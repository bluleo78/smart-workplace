package com.workplace.issue.outbound;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** ai-agent 발사 관련 Bean 등록. */
@Configuration
public class OutboundConfig {

  /** ai-agent 전용 RestClient 를 구성한 client bean. production 백오프 1초. 테스트는 생성자 직접 호출로 override. */
  @Bean
  public AiAgentEventClient aiAgentEventClient(AiAgentProperties props) {
    var builder = RestClient.builder().baseUrl(props.baseUrl());
    return new AiAgentEventClient(builder, props.internalToken(), 1000L);
  }
}
