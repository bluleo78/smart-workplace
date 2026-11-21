package com.workplace.support;

import com.workplace.global.tenant.TenantContext;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 행 잠금 경합 통합 테스트의 공용 대기 헬퍼. 시간 단언 없이 "잠금 대기에 들어섰다"·"신호가 왔다" 조건만 기다려, 두 트랜잭션의 순서를 결정적으로 맞춘다(부하에서도 같은
 * 순서).
 */
public final class RowLockWaits {

  private RowLockWaits() {}

  /**
   * waiter 가 행 잠금을 기다리는 상태가 될 때까지 기다린다(최대 10초). 테스트 풀이 작아 풀 밖의 별도 커넥션(컨테이너 소유자 롤)으로 본다 — 풀에서 빌리면
   * waiter 가 커넥션을 못 받아 잠금에 닿지 못할 수 있다. pg_stat_activity 는 다른 롤 세션의 대기 상태를 권한으로 가리므로 롤과 무관하게 보이는
   * pg_locks 를 본다.
   */
  public static void awaitLockWaiter(Future<?> waiter) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    var db = PostgresTestContainer.INSTANCE;
    try (Connection c =
            DriverManager.getConnection(db.getJdbcUrl(), db.getUsername(), db.getPassword());
        PreparedStatement ps =
            c.prepareStatement("select count(*) from pg_locks where not granted")) {
      while (System.nanoTime() < deadline) {
        try (ResultSet rs = ps.executeQuery()) {
          if (rs.next() && rs.getLong(1) > 0) return;
        }
        // 잠금에 닿기 전에 끝났으면 기다릴 이유가 없다 — 결과(예외)를 그대로 보인다.
        if (waiter.isDone()) {
          Object result = waiter.get();
          throw new AssertionError(
              "잠금 대기 전에 끝났다: " + result, result instanceof Throwable t ? t : null);
        }
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

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 뒤 second 를 보내, second 가 그 잠금을 기다리는 것을 확인한 뒤 first 를 커밋시킨다.
   * second 의 결과(값 또는 예외)를 돌려준다. 두 스레드 모두 tenantId 컨텍스트로 돈다. 잠금 경합 통합 테스트(WP-1951·WP-820)의 공용 하네스.
   */
  public static Object race(
      PlatformTransactionManager txManager, long tenantId, Runnable first, Callable<Object> second)
      throws Exception {
    return hold(txManager, tenantId, first, second, true);
  }

  /**
   * first 를 트랜잭션 안에서 실행하고 커밋 전에 멈춘 채로 second 를 보내, second 가 그 잠금을 기다리지 않고 5초 안에 끝난 결과(값 또는 예외)를
   * 돌려준다(끝나지 않으면 TimeoutException). 잠금을 잡지 않아야 하는 호출(권한 없는 호출자 등)을 확인하는 데 쓴다. 결과를 받은 뒤 first 를
   * 커밋시킨다.
   */
  public static Object whileHolding(
      PlatformTransactionManager txManager, long tenantId, Runnable first, Callable<Object> second)
      throws Exception {
    return hold(txManager, tenantId, first, second, false);
  }

  /**
   * race·whileHolding 의 공용 몸체 — first 를 커밋 전에 멈춰 잠금을 쥐게 한 뒤 second 를 보낸다. secondWaits 면 second 가 잠금
   * 대기에 들어선 것을 확인한 뒤 first 를 커밋시키고 second 결과를, 아니면 first 가 잠금을 쥔 동안 second 결과를 먼저 받고 first 를 커밋시킨다.
   */
  private static Object hold(
      PlatformTransactionManager txManager,
      long tenantId,
      Runnable first,
      Callable<Object> second,
      boolean secondWaits)
      throws Exception {
    CountDownLatch firstDone = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<?> f1 =
          pool.submit(
              () -> {
                TenantContext.set(tenantId);
                try {
                  new TransactionTemplate(txManager)
                      .executeWithoutResult(
                          st -> {
                            first.run();
                            firstDone.countDown();
                            // 커밋 전에 멈춰 잠금을 쥔 채 second 가 그 잠금을 기다릴 때까지 둔다.
                            // 상한은 main 의 잠금 대기 확인(최대 10초)보다 넉넉히 — 놓아 주기 전에 먼저 풀려 순서가 바뀌지 않게.
                            try {
                              if (!release.await(30, TimeUnit.SECONDS)) {
                                throw new AssertionError("release 신호가 오지 않았다");
                              }
                            } catch (InterruptedException e) {
                              Thread.currentThread().interrupt();
                              throw new AssertionError(e);
                            }
                          });
                } finally {
                  TenantContext.clear();
                }
              });
      // first 가 커밋 전 멈춤에 닿지 못했으면(예외·지연) 순서를 보장할 수 없다 — 결과를 버리지 않고 그 이유로 실패한다(WP-1647).
      if (!firstDone.await(30, TimeUnit.SECONDS)) {
        if (f1.isDone()) f1.get();
        throw new AssertionError("first 가 커밋 전 멈춤에 닿지 못했다");
      }
      Future<Object> f2 =
          pool.submit(
              () -> {
                TenantContext.set(tenantId);
                try {
                  return second.call();
                } catch (Exception e) {
                  return e;
                } finally {
                  TenantContext.clear();
                }
              });
      if (!secondWaits) {
        // first 가 잠금을 쥔 채이므로, second 가 그 잠금을 기다리면 여기서 시간 초과로 실패한다.
        Object result = f2.get(5, TimeUnit.SECONDS);
        release.countDown();
        f1.get(20, TimeUnit.SECONDS);
        return result;
      }
      // second 가 first 의 잠금을 실제로 기다리는 상태가 된 뒤에 first 를 커밋시킨다 — sleep 으로 가정하면 부하에서 순서가
      // 어긋난다(WP-1646·1647).
      awaitLockWaiter(f2);
      release.countDown();
      f1.get(20, TimeUnit.SECONDS);
      return f2.get(20, TimeUnit.SECONDS);
    } finally {
      release.countDown();
      pool.shutdownNow();
      pool.awaitTermination(30, TimeUnit.SECONDS);
    }
  }
}
