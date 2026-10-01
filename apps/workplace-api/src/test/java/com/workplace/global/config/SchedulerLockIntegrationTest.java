package com.workplace.global.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.time.Instant;
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
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.autoconfigure.aop.AopAutoConfiguration;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DelegatingDataSource;

/**
 * 스케줄러 분산 잠금(WP-165) 통합 검증 — 실제 Postgres {@code shedlock} 테이블과 런타임 롤(app_tenant)로 잠금이 동작하는지 본다.
 *
 * <p>테스트 프로파일은 잠금을 끈다({@code workplace.scheduling.lock-enabled=false}). 속성을 바꿔 켜면 Spring 컨텍스트가 하나 더
 * 뜨므로, 공유 컨텍스트의 DataSource 로 운영과 같은 잠금 제공자({@link SchedulerLockConfig#lockProvider})를 직접 만들고, 잠금
 * AOP 는 {@link ApplicationContextRunner} 로 작은 컨텍스트에서 확인한다.
 */
class SchedulerLockIntegrationTest extends IntegrationTestBase {

  @Autowired private DataSource dataSource;

  private LockProvider lockProvider;

  @BeforeEach
  void setUpProvider() {
    lockProvider = new SchedulerLockConfig().lockProvider(dataSource);
  }

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

  /** {@code @SchedulerLock} 이 붙은 빈 — 잠금 AOP 가 가로채는지 호출 횟수로 확인한다. */
  public static class LockedJob {
    final AtomicInteger runs = new AtomicInteger();

    @SchedulerLock(name = "test.proxy")
    public void run() {
      runs.incrementAndGet();
    }

    /** 호출 횟수 — 빈은 CGLIB 프록시라 필드를 직접 읽으면 프록시 자신의 빈 필드가 보인다. 메서드로 읽는다. */
    public int runCount() {
      return runs.get();
    }
  }

  /**
   * 운영 설정(SchedulerLockConfig)으로 띄운 빈 호출이 잠금 AOP 를 거치는지 — 작업 이름의 잠금 행이 생기고, lockAtLeastFor(기본 10초)
   * 안의 재호출은 건너뛰어진다. 잠금 대상 메서드는 프록시가 가로채도록 public 이어야 한다.
   */
  @Test
  void 잠금이_붙은_빈을_호출하면_잠금을_잡고_곧바로_다시_부르면_건너뛴다() {
    new ApplicationContextRunner()
        .withConfiguration(AutoConfigurations.of(AopAutoConfiguration.class))
        .withUserConfiguration(SchedulerLockConfig.class)
        // 공유 컨텍스트의 Hikari 풀을 직접 넘기면 이 작은 컨텍스트가 닫힐 때 close() 로 풀까지 닫힌다 — close 가 없는 래퍼로 넘긴다
        .withBean(DataSource.class, () -> new DelegatingDataSource(dataSource))
        .withBean(LockedJob.class)
        .run(
            ctx -> {
              LockedJob job = ctx.getBean(LockedJob.class);
              job.run();
              job.run();

              assertThat(job.runCount()).isEqualTo(1);
              assertThat(
                      new JdbcTemplate(dataSource)
                          .queryForList(
                              "SELECT name FROM shedlock WHERE lock_until > timezone('utc', CURRENT_TIMESTAMP)",
                              String.class))
                  .contains("test.proxy");
            });
  }
}
