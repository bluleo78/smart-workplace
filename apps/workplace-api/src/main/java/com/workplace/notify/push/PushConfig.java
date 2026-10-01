package com.workplace.notify.push;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 푸시 전용 실행기. 외부 푸시 서비스 지연이 도메인 API·SSE 알림 스레드(notifyEventExecutor)를 막지 않도록 분리하고, 큐가 넘치면 버린다(푸시는
 * best-effort). TenantContextTaskDecorator 로 발행 스레드의 테넌트를 복원해 표시 정보 조회(RLS)가 동작하게 한다.
 */
@Slf4j
@Configuration
public class PushConfig {

  @Bean(name = "pushExecutor")
  public Executor pushExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(4);
    ex.setMaxPoolSize(4);
    ex.setQueueCapacity(1000);
    ex.setThreadNamePrefix("push-");
    ex.setTaskDecorator(new TenantContextTaskDecorator());
    // 큐 초과 시 호출 스레드를 막지 않고 로그 후 버린다.
    ex.setRejectedExecutionHandler((r, pool) -> log.warn("[push] 실행 큐 초과 — 푸시 1건 폐기"));
    ex.initialize();
    return ex;
  }
}
