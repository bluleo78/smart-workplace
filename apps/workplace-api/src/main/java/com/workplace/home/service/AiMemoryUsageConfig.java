package com.workplace.home.service;

import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 메모리 사용 시각 갱신 전용 실행기(WP-385). 단일 스레드 + 작은 큐 — 갱신은 응답을 늦추지 않게 커밋 뒤에 따로 돌고, 넘치면 버린다(다음 사용 때 다시 오른다).
 * 임베딩 실행기와 나누는 이유: 임베딩은 워커 HTTP 를 수 초 기다리므로 같은 줄에 서면 사용 시각이 한참 늦게 오른다.
 */
@Slf4j
@Configuration
public class AiMemoryUsageConfig {

  /** 큐 상한 — 넘치면 버린다. */
  static final int QUEUE_CAPACITY = 200;

  @Bean(name = "aiMemoryUsageExecutor")
  public Executor aiMemoryUsageExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(1);
    ex.setMaxPoolSize(1);
    ex.setQueueCapacity(QUEUE_CAPACITY);
    ex.setThreadNamePrefix("memory-usage-");
    ex.setRejectedExecutionHandler((r, pool) -> log.debug("[memory-usage] 큐 초과 — 이번 갱신은 버림"));
    ex.initialize();
    return ex;
  }
}
