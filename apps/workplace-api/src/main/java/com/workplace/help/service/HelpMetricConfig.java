package com.workplace.help.service;

import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** 도움말 측정 기록 전용 실행기(WP-1512). 단일 스레드 + 작은 큐 — 기록은 채팅 응답을 늦추지 않게 따로 돌고, 넘치면 버린다(지표 한 건이 빠질 뿐이다). */
@Slf4j
@Configuration
public class HelpMetricConfig {

  /** 큐 상한 — 넘치면 버린다. */
  static final int QUEUE_CAPACITY = 200;

  @Bean(name = "helpMetricExecutor")
  public Executor helpMetricExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(1);
    ex.setMaxPoolSize(1);
    ex.setQueueCapacity(QUEUE_CAPACITY);
    ex.setThreadNamePrefix("help-metric-");
    // 배포·종료 때 큐에 남은 기록(AI_GAP 등)을 버리지 않고 잠깐 마저 쓴다.
    ex.setWaitForTasksToCompleteOnShutdown(true);
    ex.setAwaitTerminationSeconds(10);
    ex.setRejectedExecutionHandler((r, pool) -> log.debug("[help-metric] 큐 초과 — 이번 기록은 버림"));
    ex.initialize();
    return ex;
  }
}
