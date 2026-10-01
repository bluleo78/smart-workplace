package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.auth.service.LoginAttemptCleanupScheduler;
import com.workplace.calendar.service.CalendarReminderScheduler;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import javax.sql.DataSource;
import net.javacrumbs.shedlock.core.DefaultLockingTaskExecutor;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.LockingTaskExecutor;
import net.javacrumbs.shedlock.core.LockingTaskExecutor.TaskResult;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;

/**
 * 스케줄러 분산 잠금(WP-165) 통합 검증 — 실제 Postgres {@code shedlock} 테이블과 런타임 롤(app_tenant)로 잠금이 동작하는지 본다.
 *
 * <p>테스트 프로파일은 잠금을 끄므로({@code workplace.scheduling.lock-enabled=false}) 여기서만 켠다. 스케줄링 자체는 꺼진 채라 작업은
 * 테스트가 직접 호출할 때만 돈다.
 */
@TestPropertySource(properties = "workplace.scheduling.lock-enabled=true")
class SchedulerLockIntegrationTest extends IntegrationTestBase {

  @Autowired private LockProvider lockProvider;
  @Autowired private DataSource dataSource;
  @Autowired private CalendarReminderScheduler reminderScheduler;
  @Autowired private LoginAttemptCleanupScheduler loginAttemptCleanup;

  /** 잠금 행은 커밋된다(비-트랜잭션 테스트) — 다른 테스트가 같은 이름을 잡지 못하게 지운다. shedlock 은 비-RLS 라 GUC 불필요. */
  @AfterEach
  void clearLocks() {
    new JdbcTemplate(dataSource).update("DELETE FROM shedlock");
  }

  @Test
  void 같은_이름의_작업이_동시에_실행되면_하나만_실행되고_나머지는_건너뛴다() throws Exception {
    LockingTaskExecutor executor = new DefaultLockingTaskExecutor(lockProvider);
    LockConfiguration config =
        new LockConfiguration(
            Instant.now(), "test.concurrent", Duration.ofMinutes(1), Duration.ZERO);
    AtomicInteger runs = new AtomicInteger();
    CountDownLatch holding = new CountDownLatch(1); // 첫 실행이 잠금을 잡고 작업 중
    CountDownLatch release = new CountDownLatch(1); // 두 번째 시도가 끝난 뒤 첫 실행을 끝낸다

    ExecutorService pool = Executors.newFixedThreadPool(2);
    try {
      Future<TaskResult<Integer>> first =
          pool.submit(
              () ->
                  withLock(
                      executor,
                      config,
                      () -> {
                        runs.incrementAndGet();
                        holding.countDown();
                        release.await(10, TimeUnit.SECONDS);
                        return 1;
                      }));
      assertThat(holding.await(10, TimeUnit.SECONDS)).isTrue();

      // 첫 실행이 잠금을 쥔 동안 다른 파드(스레드)의 시도 — 기다리지 않고 건너뛴다
      TaskResult<Integer> second =
          pool.submit(
                  () ->
                      withLock(
                          executor,
                          config,
                          () -> {
                            runs.incrementAndGet();
                            return 2;
                          }))
              .get(10, TimeUnit.SECONDS);
      release.countDown();

      assertThat(first.get(10, TimeUnit.SECONDS).wasExecuted()).isTrue();
      assertThat(second.wasExecuted()).isFalse();
      assertThat(runs).hasValue(1);
    } finally {
      release.countDown();
      pool.shutdownNow();
    }
  }

  @Test
  void 작업이_끝나면_잠금이_풀려_다음_회차는_다시_실행된다() throws Throwable {
    LockingTaskExecutor executor = new DefaultLockingTaskExecutor(lockProvider);
    LockConfiguration config =
        new LockConfiguration(
            Instant.now(), "test.sequential", Duration.ofMinutes(1), Duration.ZERO);

    assertThat(executor.executeWithLock(() -> 1, config).wasExecuted()).isTrue();
    assertThat(
            executor
                .executeWithLock(
                    () -> 2,
                    new LockConfiguration(
                        Instant.now(), "test.sequential", Duration.ofMinutes(1), Duration.ZERO))
                .wasExecuted())
        .isTrue();
  }

  /** executeWithLock 은 Throwable 을 던진다 — 스레드 풀 Callable 에서 쓰도록 런타임 예외로 감싼다. */
  private static <T> TaskResult<T> withLock(
      LockingTaskExecutor executor,
      LockConfiguration config,
      LockingTaskExecutor.TaskWithResult<T> task) {
    try {
      return executor.executeWithLock(task, config);
    } catch (Throwable e) {
      throw new IllegalStateException(e);
    }
  }

  /**
   * 실제 스케줄러 빈 호출이 잠금 AOP 를 거치는지 — 작업 이름의 잠금 행이 생기고 lockAtLeastFor(기본 10초) 동안 유지된다. 부작용이 작은 작업(리마인더
   * 폴링·로그인 시도 정리)으로 확인한다. 잠금 대상 메서드는 프록시가 가로채도록 모두 public 이다.
   */
  @Test
  void 스케줄러_빈을_호출하면_작업_이름으로_잠금을_잡는다() {
    reminderScheduler.poll();
    loginAttemptCleanup.cleanupExpired();

    List<String> names =
        new JdbcTemplate(dataSource)
            .queryForList(
                "SELECT name FROM shedlock WHERE lock_until > timezone('utc', CURRENT_TIMESTAMP)",
                String.class);
    assertThat(names)
        .contains("CalendarReminderScheduler.poll", "LoginAttemptCleanupScheduler.cleanupExpired");
  }
}
