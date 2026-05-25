package com.workplace.issue.outbound;

import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.client.RestClient;

/** ai-agent 발사 관련 Bean 등록. @EnableAsync 로 dispatcher 핸들러를 별도 executor 에서 실행. */
@Configuration
@EnableAsync
public class OutboundConfig {

  /** ai-agent 전용 RestClient 를 구성한 client bean. production 백오프 1초. 테스트는 생성자 직접 호출로 override. */
  @Bean
  public AiAgentEventClient aiAgentEventClient(AiAgentProperties props) {
    var builder = RestClient.builder().baseUrl(props.baseUrl());
    return new AiAgentEventClient(builder, props.internalToken(), 1000L);
  }

  /**
   * ai-agent 발사 전용 executor. dispatcher 의 @TransactionalEventListener 핸들러를 호출 스레드와 분리해 ai-agent 다운
   * 시의 HTTP 재시도 백오프(최대 7s)가 도메인 API 응답을 막지 않도록 보장한다. core/max 2/4, queue 100 — 발사 부하는 매우 낮으므로 충분.
   */
  @Bean(name = "aiAgentEventExecutor")
  public Executor aiAgentEventExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(100);
    executor.setThreadNamePrefix("ai-agent-");
    executor.initialize();
    return executor;
  }
}
