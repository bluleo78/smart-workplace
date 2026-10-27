package com.workplace.support;

import static org.awaitility.Awaitility.await;

import java.time.Duration;
import java.util.concurrent.Executor;
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
}
