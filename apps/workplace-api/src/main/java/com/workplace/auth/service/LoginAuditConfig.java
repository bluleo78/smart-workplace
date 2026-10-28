package com.workplace.auth.service;

import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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

  @Bean(name = EXECUTOR)
  public Executor loginAuditExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(1);
    ex.setMaxPoolSize(1);
    ex.setQueueCapacity(QUEUE_CAPACITY);
    ex.setThreadNamePrefix("login-audit-");
    // 배포·종료 때 큐에 남은 기록을 버리지 않고 잠깐 마저 쓴다.
    ex.setWaitForTasksToCompleteOnShutdown(true);
    ex.setAwaitTerminationSeconds(10);
    ex.setRejectedExecutionHandler((r, pool) -> log.warn("[login-audit] 큐 초과 — 로그인 실패 감사 한 건을 버림"));
    ex.initialize();
    return ex;
  }
}
