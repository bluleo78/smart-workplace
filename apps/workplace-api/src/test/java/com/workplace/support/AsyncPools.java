package com.workplace.support;

import static org.awaitility.Awaitility.await;

import java.time.Duration;
import java.util.concurrent.Executor;
import org.awaitility.core.ConditionTimeoutException;
import org.springframework.context.ApplicationContext;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 비동기 풀이 받은 일을 모두 마칠 때까지 기다린다(WP-1028).
 *
 * <p>「알림·이벤트가 생기지 않음」 확인을 고정 대기(Thread.sleep·during) 대신 쓴다. AFTER_COMMIT 핸들러는 커밋한 스레드에서 바로 이 풀에 일을
 * 넣으므로, 커밋이 끝난 뒤 풀이 비면 생길 결과는 이미 생겼다. 풀 안의 일이 다른 풀로 또 넘기는 경로에는 맞지 않는다.
 */
public final class AsyncPools {

  private AsyncPools() {}

  /** 제출된 일 수와 끝난 일 수가 같아질 때까지(최대 3초) 기다린다. */
  public static void awaitIdle(Executor executor) {
    var pool = ((ThreadPoolTaskExecutor) executor).getThreadPoolExecutor();
    await()
        .pollInterval(Duration.ofMillis(20))
        .atMost(Duration.ofSeconds(3))
        .until(() -> pool.getCompletedTaskCount() == pool.getTaskCount());
  }

  /**
   * 컨텍스트의 모든 스레드 풀이 받은 일을 마칠 때까지 기다린다 — 커밋 데이터를 지우는 정리 전에 쓴다(WP-1182). 테스트의 요청이 커밋 뒤 넘긴 일(알림·AI
   * 깨우기·터치 등)이 아직 행을 잡고 있으면 정리의 사용자 삭제(CASCADE)와 순환 대기가 생겼다. 오래 도는 일이 있어 3초 안에 비지 않는 풀은 기다리지 않고
   * 넘어간다 — 정리는 교착 재시도로 마저 버틴다.
   */
  public static void awaitAllIdleQuietly(ApplicationContext ctx) {
    for (Executor executor : ctx.getBeansOfType(Executor.class).values()) {
      if (!(executor instanceof ThreadPoolTaskExecutor pool)) continue;
      // 이미 빈 풀은 기다리지 않는다 — Awaitility 는 첫 확인 전에 폴링 간격만큼 쉬어, 풀 수만큼 테스트마다 수백 ms 가 붙었다.
      var tp = pool.getThreadPoolExecutor();
      if (tp.getCompletedTaskCount() == tp.getTaskCount()) continue;
      try {
        awaitIdle(executor);
      } catch (ConditionTimeoutException e) {
        // 비지 않는 풀(장기 실행 일)은 정리를 막지 않는다.
      }
    }
  }
}
