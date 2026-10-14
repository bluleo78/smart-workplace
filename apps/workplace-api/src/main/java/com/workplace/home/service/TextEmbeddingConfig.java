package com.workplace.home.service;

import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 커밋 뒤 임베딩 채우기 전용 실행기(WP-383·384). 단일 스레드 — 워커(ollama BGE-M3) 한 대가 순차로 처리하므로 동시 요청을 늘려도 빨라지지 않고 채팅의
 * 질의 임베딩(1.5초 대기)을 밀어낸다. 큐가 넘치면 버리고 백필(1분)이 채운다. 테넌트는 작업이 직접 세운다(TextEmbeddingService).
 */
@Slf4j
@Configuration
public class TextEmbeddingConfig {

  /** 큐 상한 — 넘치면 버리고 백필이 채운다. */
  static final int QUEUE_CAPACITY = 500;

  @Bean(name = "textEmbeddingExecutor")
  public Executor textEmbeddingExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(1);
    ex.setMaxPoolSize(1);
    ex.setQueueCapacity(QUEUE_CAPACITY);
    ex.setThreadNamePrefix("text-embed-");
    ex.setRejectedExecutionHandler((r, pool) -> log.debug("[text-embed] 큐 초과 — 백필로 미룸"));
    ex.initialize();
    return ex;
  }
}
