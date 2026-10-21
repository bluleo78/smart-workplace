package com.workplace.fileai.service;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 커밋 뒤 추출·임베딩 nudge 실행기(WP-751).
 *
 * <p>nudge 는 새 트랜잭션에서 행을 선점하고 워커 HTTP 를 부른다. 이걸 커밋한 스레드에서 바로 하면 아직 반납되지 않은 원 커넥션을 쥔 채 두 번째 커넥션을 빌리고
 * HTTP 까지 기다려, 동시 업로드가 풀 크기를 넘으면 모두가 서로를 기다리며 멈췄다. 별도 스레드로 넘기면 원 커넥션은 곧바로 반납된다.
 *
 * <p>큐가 넘치면 버린다 — 행이 PENDING 으로 남아 FileExtractionScheduler·FileEmbeddingScheduler 백스톱이 다시 디스패치한다.
 * 호출 스레드 실행(CallerRuns)은 쓰지 않는다 — 넘칠 때 다시 커밋 스레드에서 돌아 같은 교착을 부른다.
 */
@Slf4j
@Configuration
public class FileAiNudgeExecutorConfig {

  /** {@code @Async} 로 지정할 빈 이름. */
  public static final String EXECUTOR = "fileAiNudgeExecutor";

  @Bean(name = EXECUTOR)
  public ThreadPoolTaskExecutor fileAiNudgeExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    // core 와 max 를 같게 둔다 — 큐가 다 차기 전에는 core 를 넘는 스레드가 생기지 않는다.
    ex.setCorePoolSize(2);
    ex.setMaxPoolSize(2);
    ex.setQueueCapacity(500);
    ex.setThreadNamePrefix("fileai-nudge-");
    // TenantContext 전파 — 새 트랜잭션 시작 시 TenantAwareTransactionManager 가 GUC 를 주입하게 한다.
    ex.setTaskDecorator(new TenantContextTaskDecorator());
    ex.setRejectedExecutionHandler(
        (r, pool) -> log.warn("[fileai] nudge 큐 초과 — 1건 버림(스케줄러 백스톱이 다시 디스패치)"));
    // initialize() 는 빈 수명주기(afterPropertiesSet)가 부른다.
    return ex;
  }
}
