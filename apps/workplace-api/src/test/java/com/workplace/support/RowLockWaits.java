package com.workplace.support;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

/**
 * 행 잠금 경합 통합 테스트의 공용 대기 헬퍼. 시간 단언 없이 "잠금 대기에 들어섰다"·"신호가 왔다" 조건만 기다려, 두 트랜잭션의 순서를 결정적으로 맞춘다(부하에서도 같은
 * 순서).
 */
public final class RowLockWaits {

  private RowLockWaits() {}

  /**
   * waiter 가 행 잠금을 기다리는 상태가 될 때까지 기다린다(최대 10초). 테스트 풀이 작아 풀 밖의 별도 커넥션으로 본다 — 풀에서 빌리면 waiter 가 커넥션을
   * 못 받아 잠금에 닿지 못할 수 있다. pg_stat_activity 는 다른 롤 세션의 대기 상태를 권한으로 가리므로 롤과 무관하게 보이는 pg_locks 를 본다.
   */
  public static void awaitLockWaiter(String url, String user, String password, Future<?> waiter)
      throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    try (Connection c = DriverManager.getConnection(url, user, password);
        PreparedStatement ps =
            c.prepareStatement("select count(*) from pg_locks where not granted")) {
      while (System.nanoTime() < deadline) {
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next() && rs.getLong(1) > 0) return;
        }
        // 잠금에 닿기 전에 끝났으면 기다릴 이유가 없다 — 결과(예외)를 그대로 보인다.
        if (waiter.isDone()) throw new AssertionError("잠금 대기 전에 끝났다: " + waiter.get());
        Thread.sleep(20); // 잠금 대기 진입을 관측하는 폴링 간격 — 조건 대기다.
      }
    }
    throw new AssertionError("행 잠금을 기다리는 상태가 되지 않았다");
  }

  /** 잠금을 쥔 쪽이 release 신호를 기다린다(최대 10초). 신호가 오지 않으면 테스트를 실패시킨다. */
  public static void awaitQuietly(CountDownLatch latch) {
    try {
      if (!latch.await(10, TimeUnit.SECONDS)) throw new AssertionError("release 신호가 오지 않았다");
    } catch (InterruptedException e) {
      Thread.currentThread().interrupt();
      throw new AssertionError(e);
    }
  }
}
