package com.workplace.global.outbound;

import com.workplace.global.tenant.TenantContextTaskDecorator;
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
    // TenantContext 전파 — 향후 핸들러가 RLS 테이블을 읽을 때도 GUC 가 올바르게 주입되도록.
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }

  /**
   * notify 디스패처 전용 executor. @Async 무인자는 단일 Executor 빈(aiAgentEventExecutor)에 바인딩되거나, 빈이 2개면 모호해져
   * SimpleAsyncTaskExecutor 로 조용히 폴백한다. 따라서 항상 명시 한정(@Async("notifyEventExecutor"))한다. 알림은 가벼운
   * insert+fan-out 이므로 작은 풀로 충분, queue 는 버스트 흡수용으로 넉넉히.
   */
  @Bean(name = "notifyEventExecutor")
  public Executor notifyEventExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(4);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("notify-");
    // TenantContext 전파 — @Async AFTER_COMMIT 핸들러가 워커 스레드에서 트랜잭션을 시작할 때
    // TenantAwareTransactionManager 가 GUC(app.tenant_id) 를 주입할 수 있도록.
    // (issue_watcher 등 RLS 보호 테이블 조회가 fail-closed 로 차단되지 않도록 하는 핵심 조치)
    executor.setTaskDecorator(new TenantContextTaskDecorator());
    executor.initialize();
    return executor;
  }
}
