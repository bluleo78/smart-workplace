package com.workplace.wiki.outbound;

import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import java.util.concurrent.Executor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** 노트 동기화 서버 연동 빈 — {@link CollabClient} 와 재검증 알림 전용 executor(WP-285). */
@Configuration
public class CollabClientConfig {

  /**
   * connect 3s / read 30s. apply-markdown 은 동기화 서버가 문서를 메모리에 올리고(필요 시 API 에서 로드) 잠금 대기·적용 직전
   * 저장·3-way 병합·적용·즉시 저장까지 마친 뒤 응답한다(WP-289). 동기화 서버는 적용 직전까지를 전체 기한 20s(workplace-collab server.ts
   * 의 APPLY_DEADLINE_MS)로 끊어 503(아무것도 적용 안 함)으로 답하므로, 남은 10s 가 적용 뒤 즉시 저장 한 번의 여유다 — 이 read 30s 를
   * 줄이면 그 기한도 함께 줄여야 한다. 타임아웃은 결과를 모르는 실패라 503.
   */
  @Bean
  public CollabClient collabClient(CollabProperties props) {
    // HTTP/1.1 고정 — InternalHttp 참조
    var builder =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(3), Duration.ofSeconds(30));
    return new CollabClient(builder, props.internalToken());
  }

  /**
   * 재검증 알림 전용 executor. 커밋 후 HTTP 호출이 요청 스레드를 붙잡지 않도록(동기화 서버 장애 시 최대 타임아웃만큼 응답 지연) 분리한다. 이벤트가
   * tenantId 를 직접 싣고 DB 를 건드리지 않으므로 TenantContext 전파 데코레이터는 필요 없다. bare {@code @Async} 의 무제한 폴백을
   * 피하려고 이름으로 한정해 쓴다.
   */
  @Bean(name = "wikiCollabRevalidateExecutor")
  public Executor wikiCollabRevalidateExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("wiki-collab-");
    executor.initialize();
    return executor;
  }
}
