package com.workplace.auth.service;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 로그인 실패 감사를 쓰는 전용 풀(WP-1152). 요청 스레드가 기록을 기다리지 않게 해 계정 존재가 응답 시간으로 드러나지 않게 한다({@link
 * LoginFailureAuditor}). 잠금(5회)이 계정당 기록 수를 묶지만 여러 계정을 동시에 두드리면 몰릴 수 있어 큐에 상한을 두고, 넘치면 버린다.
 */
@Slf4j
@Configuration
public class LoginAuditConfig {

  static final String EXECUTOR = "loginAuditExecutor";

  /** 큐 상한 — 넘치면 그 기록은 버린다. */
  static final int QUEUE_CAPACITY = 1000;

  /** 버린 건수 메트릭 이름. */
  static final String DROPPED_METRIC = "login.audit.dropped";

  @Bean
  DroppedAudits loginAuditDropped(MeterRegistry meterRegistry) {
    return new DroppedAudits(
        Counter.builder(DROPPED_METRIC)
            .description("큐가 넘쳐 버린 로그인 실패 감사 건수")
            .register(meterRegistry));
  }

  @Bean(name = EXECUTOR)
  public Executor loginAuditExecutor(DroppedAudits dropped) {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(1);
    ex.setMaxPoolSize(1);
    ex.setQueueCapacity(QUEUE_CAPACITY);
    ex.setThreadNamePrefix("login-audit-");
    // 배포·종료 때 큐에 남은 기록을 버리지 않고 잠깐 마저 쓴다.
    ex.setWaitForTasksToCompleteOnShutdown(true);
    ex.setAwaitTerminationSeconds(10);
    ex.setRejectedExecutionHandler(
        (r, pool) -> {
          // 종료 중 거절은 큐 초과(공격 신호)가 아니다 — 세지 않는다.
          if (pool.isShutdown()) {
            log.info("[login-audit] 종료 중 — 로그인 실패 감사 한 건을 쓰지 못함");
            return;
          }
          dropped.drop();
        });
    ex.initialize();
    return ex;
  }

  /**
   * 큐가 넘쳐 버린 감사 건수(WP-1161). 버릴 때는 메트릭과 건수만 올리고(요청 스레드), 경고 로그는 1분마다 그동안 버린 건수를 모아 한 번 남긴다 — 전에는 버릴
   * 때마다 요청 스레드에서 경고를 써, 공격이 몰릴수록 로그가 쏟아지고 있는 계정의 응답만 그만큼 늦어졌다.
   */
  public static final class DroppedAudits {

    private final Counter counter;
    private final AtomicLong pending = new AtomicLong();

    DroppedAudits(Counter counter) {
      this.counter = counter;
    }

    /** 한 건 버렸다. */
    void drop() {
      counter.increment();
      pending.incrementAndGet();
    }

    /**
     * 지난 1분 동안 버린 건수를 경고 한 줄로 남긴다(버린 것이 없으면 남기지 않는다). 파드마다 자기 메모리의 건수를 내보내야 해 분산 잠금을 걸지 않는다({@code
     * ScheduledLockArchTest} 예외).
     */
    @Scheduled(fixedDelay = 60_000, initialDelay = 60_000)
    public void flush() {
      long n = pending.getAndSet(0);
      if (n > 0) log.warn("[login-audit] 큐 초과 — 로그인 실패 감사 {}건을 버림(지난 1분)", n);
    }

    /** 아직 경고로 남기지 않은 버린 건수 — 테스트용. */
    long pending() {
      return pending.get();
    }
  }
}
