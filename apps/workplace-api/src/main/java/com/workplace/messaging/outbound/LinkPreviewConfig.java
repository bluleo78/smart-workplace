package com.workplace.messaging.outbound;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 링크 미리보기 가져오기 전용 실행기(WP-874). 외부 사이트 지연(건당 최대 5초)이 다른 비동기 작업을 막지 않도록 분리하고, 큐가 넘치면 버린다(미리보기는
 * best-effort). TenantContextTaskDecorator 로 발행 스레드의 테넌트를 복원해 워커의 트랜잭션이 tenant GUC 를 주입받게
 * 한다(PushConfig 와 같은 패턴 — 빠지면 RLS 표 조회가 빈 결과, INSERT 가 정책 위반).
 */
@Slf4j
@Configuration
public class LinkPreviewConfig {

  @Bean(name = "linkPreviewExecutor")
  public Executor linkPreviewExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(4);
    ex.setMaxPoolSize(4);
    ex.setQueueCapacity(500);
    ex.setThreadNamePrefix("link-preview-");
    ex.setTaskDecorator(new TenantContextTaskDecorator());
    // 큐 초과 시 호출 스레드를 막지 않고 로그 후 버린다.
    ex.setRejectedExecutionHandler((r, pool) -> log.warn("[link-preview] 실행 큐 초과 — 미리보기 1건 폐기"));
    ex.initialize();
    return ex;
  }

  /**
   * 한 메시지의 URL(최대 3개)을 나란히 가져오는 실행기. DB 를 쓰지 않는 순수 HTTP 라 테넌트 전파가 필요 없다. 큐가 차면 호출 스레드(위
   * linkPreviewExecutor 워커)가 직접 가져온다(CallerRuns) — 버리지 않고 순차로 물러날 뿐이라 미리보기가 사라지지 않는다.
   */
  @Bean(name = "linkPreviewFetchExecutor")
  public Executor linkPreviewFetchExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(12);
    ex.setMaxPoolSize(12);
    ex.setQueueCapacity(36);
    ex.setThreadNamePrefix("link-preview-fetch-");
    ex.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
    ex.initialize();
    return ex;
  }
}
