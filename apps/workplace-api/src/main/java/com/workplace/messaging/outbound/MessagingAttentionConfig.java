package com.workplace.messaging.outbound;

import com.workplace.global.tenant.TenantContextTaskDecorator;
import java.util.concurrent.Executor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 메시징 어텐션 분류 전용 실행기(WP-1818).
 *
 * <p>분류는 haiku LLM 호출(최대 60초)을 품는데, 이를 짧은 이벤트 발사용 공유 풀(aiAgentEventExecutor, 코어 2/최대 4/큐 100)에서 돌리면
 * 분류가 몰릴 때 풀이 고갈돼 다른 이벤트 발사가 거절된다. 그래서 별도 풀로 분리하고, 큐가 넘치면 해당 분류 1건을 버린다 — 버린 분류는 같은 채널에 다음 메시지가 올 때
 * watermark 가 그 사이 메시지까지 메운다. 다만 그 채널이 이후 조용하면 마지막 묶음은 분류되지 않는다(best-effort, 감수한 trade-off).
 * TenantContextTaskDecorator 로 발행 스레드의 테넌트를 복원해 워커 트랜잭션이 tenant GUC 를 주입받게 한다(빠지면 RLS 표 조회가 빈 결과).
 */
@Slf4j
@Configuration
public class MessagingAttentionConfig {

  /** 어텐션 분류 실행기 — 스레드 2, 큐 50, 초과분은 로그 후 폐기. */
  @Bean(name = "messagingAttentionExecutor")
  public Executor messagingAttentionExecutor() {
    ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
    ex.setCorePoolSize(2);
    ex.setMaxPoolSize(2);
    ex.setQueueCapacity(50);
    ex.setThreadNamePrefix("messaging-attention-");
    ex.setTaskDecorator(new TenantContextTaskDecorator());
    // 거절 시 호출 스레드를 막지 않고 로그 후 버린다(best-effort — 클래스 주석).
    ex.setRejectedExecutionHandler(
        (r, pool) -> {
          if (pool.isShutdown()) {
            // 종료 중 거절은 과부하가 아니므로 경고가 아닌 info 로 남긴다.
            log.info("[messaging-attention] 종료 중 — 분류 1건 건너뜀");
          } else {
            // 큐 초과 — 진단용으로 큐 크기·활성 스레드 수를 함께 남긴다.
            log.warn(
                "[messaging-attention] 실행 큐 초과 — 분류 1건 건너뜀 (queue={}, active={})",
                pool.getQueue().size(),
                pool.getActiveCount());
          }
        });
    ex.initialize();
    return ex;
  }
}
