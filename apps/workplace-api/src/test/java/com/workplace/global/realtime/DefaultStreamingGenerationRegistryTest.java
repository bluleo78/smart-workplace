package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.workplace.global.exception.StreamingGenerationForbiddenException;
import com.workplace.global.exception.StreamingGenerationNotFoundException;
import com.workplace.global.exception.StreamingGenerationRejectedException;
import com.workplace.global.realtime.StreamingGenerationRegistry.ActiveGeneration;
import com.workplace.global.realtime.StreamingGenerationRegistry.CancelReason;
import com.workplace.global.realtime.StreamingGenerationRegistry.GenerationTag;
import com.workplace.global.realtime.StreamingGenerationRegistry.Reservation;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import org.junit.jupiter.api.Test;
import org.springframework.core.task.TaskRejectedException;
import org.springframework.core.task.support.TaskExecutorAdapter;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** DefaultStreamingGenerationRegistry 단위 테스트 — 실제 스레드풀로 취소/타임아웃 인터럽트를 검증한다. */
class DefaultStreamingGenerationRegistryTest {

  private final DefaultStreamingGenerationRegistry registry =
      new DefaultStreamingGenerationRegistry();

  private ThreadPoolTaskExecutor realExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(2);
    executor.initialize();
    return executor;
  }

  @Test
  void start_returnsUniqueCorrelationId_andRunsTaskOnExecutor() throws InterruptedException {
    CountDownLatch ran = new CountDownLatch(1);
    String id =
        registry.start(
            1L,
            new TaskExecutorAdapter(Runnable::run),
            Duration.ofSeconds(10),
            cid -> ran::countDown);
    assertThat(id).isNotBlank();
    assertThat(ran.await(1, TimeUnit.SECONDS)).isTrue();
  }

  @Test
  void cancel_unknownCorrelationId_throwsNotFound() {
    assertThatThrownBy(() -> registry.cancel("nope", 1L))
        .isInstanceOf(StreamingGenerationNotFoundException.class);
  }

  @Test
  void cancel_differentOwner_throwsForbidden() throws InterruptedException {
    ThreadPoolTaskExecutor executor = realExecutor();
    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    String id =
        registry.start(
            1L,
            executor,
            Duration.ofSeconds(10),
            cid ->
                () -> {
                  started.countDown();
                  try {
                    release.await();
                  } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                  }
                });
    assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();

    assertThatThrownBy(() -> registry.cancel(id, 999L))
        .isInstanceOf(StreamingGenerationForbiddenException.class);

    release.countDown();
    executor.shutdown();
  }

  @Test
  void cancel_ownerMatches_interruptsRunningTask() throws InterruptedException {
    ThreadPoolTaskExecutor executor = realExecutor();
    CountDownLatch started = new CountDownLatch(1);
    AtomicBoolean interrupted = new AtomicBoolean(false);
    CountDownLatch finished = new CountDownLatch(1);
    String id =
        registry.start(
            1L,
            executor,
            Duration.ofSeconds(10),
            cid ->
                () -> {
                  started.countDown();
                  try {
                    Thread.sleep(5000);
                  } catch (InterruptedException e) {
                    interrupted.set(true);
                    Thread.currentThread().interrupt();
                  } finally {
                    finished.countDown();
                  }
                });
    assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();

    registry.cancel(id, 1L);

    assertThat(finished.await(1, TimeUnit.SECONDS)).isTrue();
    assertThat(interrupted.get()).isTrue();
    executor.shutdown();
  }

  @Test
  void start_removesFromRegistryAfterCompletion() throws InterruptedException {
    ThreadPoolTaskExecutor executor = realExecutor();
    CountDownLatch finished = new CountDownLatch(1);
    String id = registry.start(1L, executor, Duration.ofSeconds(10), cid -> finished::countDown);
    assertThat(finished.await(1, TimeUnit.SECONDS)).isTrue();
    Thread.sleep(50); // finally 블록의 map 제거 반영 대기
    assertThatThrownBy(() -> registry.cancel(id, 1L))
        .isInstanceOf(StreamingGenerationNotFoundException.class);
    executor.shutdown();
  }

  @Test
  void start_timeoutCancelsRunningTask() throws InterruptedException {
    ThreadPoolTaskExecutor executor = realExecutor();
    AtomicBoolean interrupted = new AtomicBoolean(false);
    CountDownLatch finished = new CountDownLatch(1);
    registry.start(
        1L,
        executor,
        Duration.ofMillis(100),
        cid ->
            () -> {
              try {
                Thread.sleep(5000);
              } catch (InterruptedException e) {
                interrupted.set(true);
                Thread.currentThread().interrupt();
              } finally {
                finished.countDown();
              }
            });
    assertThat(finished.await(2, TimeUnit.SECONDS)).isTrue();
    assertThat(interrupted.get()).isTrue();
    executor.shutdown();
  }

  private static GenerationTag tag(String key) {
    return new GenerationTag("home", key);
  }

  /** 조건이 참이 될 때까지 최대 2초 폴링 — 다른 스레드의 반납 반영 대기. */
  private static void awaitTrue(BooleanSupplier cond) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 2000;
    while (!cond.getAsBoolean()) {
      if (System.currentTimeMillis() > deadline) throw new AssertionError("timeout");
      Thread.sleep(10);
    }
  }

  @Test
  void reserve_같은_키가_진행중이면_BUSY() {
    registry.reserve(1L, tag("s-a"), 3);
    assertThatThrownBy(() -> registry.reserve(1L, tag("s-a"), 3))
        .isInstanceOfSatisfying(
            StreamingGenerationRejectedException.class,
            e ->
                assertThat(e.reason()).isEqualTo(StreamingGenerationRejectedException.Reason.BUSY));
  }

  /** WP-267: 호출자가 정한 correlationId 로 예약하고, 진행 중인 생성과 겹치면(다른 소유자여도) BUSY — 반납 뒤엔 다시 쓸 수 있다. */
  @Test
  void reserve_요청한_correlationId_를_쓰고_진행중인_id_와_겹치면_BUSY() {
    Reservation r = registry.reserve(1L, tag("s-a"), 3, "cid-1");
    assertThat(r.correlationId()).isEqualTo("cid-1");
    assertThatThrownBy(() -> registry.reserve(2L, tag("s-b"), 3, "cid-1"))
        .isInstanceOfSatisfying(
            StreamingGenerationRejectedException.class,
            e ->
                assertThat(e.reason()).isEqualTo(StreamingGenerationRejectedException.Reason.BUSY));
    // 거절은 기존 생성을 덮지 않는다 — 원래 소유자의 생성 중 목록에 그대로 있다.
    assertThat(registry.active(1L, "home"))
        .extracting(ActiveGeneration::correlationId)
        .containsExactly("cid-1");
    r.release();
    assertThat(registry.reserve(2L, tag("s-b"), 3, "cid-1").correlationId()).isEqualTo("cid-1");
  }

  @Test
  void reserve_상한이면_LIMIT_다른_소유자와_다른_scope_는_세지_않는다() {
    // 태그 없는 기존 start() 생성은 상한에 세지 않는다(wiki·drive 영향 없음) — 태스크를 돌리지 않는
    // executor 로 슬롯을 유지한 채 3건 예약이 모두 성공하는지로 증명한다.
    registry.start(
        1L, new TaskExecutorAdapter(task -> {}), Duration.ofSeconds(10), cid -> () -> {});
    registry.reserve(1L, tag("s1"), 3);
    registry.reserve(1L, tag("s2"), 3);
    registry.reserve(1L, tag("s3"), 3);
    assertThatThrownBy(() -> registry.reserve(1L, tag("s4"), 3))
        .isInstanceOfSatisfying(
            StreamingGenerationRejectedException.class,
            e ->
                assertThat(e.reason())
                    .isEqualTo(StreamingGenerationRejectedException.Reason.LIMIT));
    assertThat(registry.reserve(2L, tag("s4"), 3)).isNotNull();
    assertThat(registry.reserve(1L, new GenerationTag("wiki", "s4"), 3)).isNotNull();
  }

  @Test
  void active_는_소유자와_scope_의_생성만_시작순으로() {
    Reservation a = registry.reserve(1L, tag("s-a"), 3);
    Reservation b = registry.reserve(1L, tag("s-b"), 3);
    registry.reserve(2L, tag("s-x"), 3);
    registry.reserve(1L, new GenerationTag("wiki", "w"), 3);
    assertThat(registry.active(1L, "home"))
        .extracting(ActiveGeneration::correlationId, ActiveGeneration::key)
        .containsExactly(tuple(a.correlationId(), "s-a"), tuple(b.correlationId(), "s-b"));
  }

  @Test
  void release_는_멱등이고_슬롯을_비운다() {
    Reservation a = registry.reserve(1L, tag("s-a"), 1);
    a.release();
    a.release();
    assertThat(registry.active(1L, "home")).isEmpty();
    assertThat(registry.reserve(1L, tag("s-a"), 1)).isNotNull();
  }

  @Test
  void launch_정상_종료되면_슬롯이_빠진다() throws InterruptedException {
    ThreadPoolTaskExecutor executor = realExecutor();
    CountDownLatch ran = new CountDownLatch(1);
    Reservation r = registry.reserve(1L, tag("s-a"), 3);
    registry.launch(r, executor, Duration.ofSeconds(10), ran::countDown, () -> {});
    assertThat(ran.await(1, TimeUnit.SECONDS)).isTrue();
    awaitTrue(() -> registry.active(1L, "home").isEmpty());
    executor.shutdown();
  }

  @Test
  void 실행_전_취소는_즉시_반납하고_태스크_대신_종결_콜백을_부른다() throws InterruptedException {
    ThreadPoolTaskExecutor single = new ThreadPoolTaskExecutor();
    single.setCorePoolSize(1);
    single.setMaxPoolSize(1);
    single.initialize();
    CountDownLatch blocker = new CountDownLatch(1);
    single.submit(
        () -> {
          try {
            blocker.await();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
        });
    AtomicBoolean ran = new AtomicBoolean(false);
    AtomicBoolean abortedBeforeStart = new AtomicBoolean(false);
    Reservation r = registry.reserve(1L, tag("s-a"), 3);
    // 큐에서 대기
    registry.launch(
        r, single, Duration.ofSeconds(10), () -> ran.set(true), () -> abortedBeforeStart.set(true));

    registry.cancel(r.correlationId(), 1L);

    assertThat(registry.active(1L, "home")).isEmpty(); // 즉시
    assertThat(r.cancelReason()).isEqualTo(CancelReason.USER);
    assertThat(abortedBeforeStart.get()).isTrue(); // 태스크가 안 돌아도 종결 이벤트를 낼 수 있게
    blocker.countDown();
    single.shutdown();
    assertThat(single.getThreadPoolExecutor().awaitTermination(1, TimeUnit.SECONDS)).isTrue();
    assertThat(ran.get()).isFalse();
  }

  @Test
  void 실행_중_취소는_태스크가_끝날_때까지_슬롯을_유지한다() throws InterruptedException {
    ThreadPoolTaskExecutor executor = realExecutor();
    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch mayExit = new CountDownLatch(1);
    AtomicBoolean abortedBeforeStart = new AtomicBoolean(false);
    Reservation r = registry.reserve(1L, tag("s-a"), 3);
    registry.launch(
        r,
        executor,
        Duration.ofSeconds(10),
        () -> {
          started.countDown();
          try {
            Thread.sleep(5000);
          } catch (InterruptedException e) {
            // 취소 후 종결 처리(부분 저장 등)를 흉내 — 이 동안 슬롯은 남아 있어야 한다.
            try {
              mayExit.await();
            } catch (InterruptedException ignored) {
              Thread.currentThread().interrupt();
            }
          }
        },
        () -> abortedBeforeStart.set(true));
    assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();

    registry.cancel(r.correlationId(), 1L);

    assertThat(r.cancelReason()).isEqualTo(CancelReason.USER);
    assertThat(registry.active(1L, "home")).hasSize(1);
    assertThat(abortedBeforeStart.get()).isFalse(); // 실행 중이면 태스크 자신이 종결한다
    mayExit.countDown();
    awaitTrue(() -> registry.active(1L, "home").isEmpty());
    executor.shutdown();
  }

  @Test
  void 타임아웃_취소의_사유는_TIMEOUT() throws InterruptedException {
    ThreadPoolTaskExecutor executor = realExecutor();
    CountDownLatch finished = new CountDownLatch(1);
    Reservation r = registry.reserve(1L, tag("s-a"), 3);
    registry.launch(
        r,
        executor,
        Duration.ofMillis(100),
        () -> {
          try {
            Thread.sleep(5000);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          } finally {
            finished.countDown();
          }
        },
        () -> {});
    assertThat(finished.await(2, TimeUnit.SECONDS)).isTrue();
    assertThat(r.cancelReason()).isEqualTo(CancelReason.TIMEOUT);
    awaitTrue(() -> registry.active(1L, "home").isEmpty());
    executor.shutdown();
  }

  @Test
  void 동시_reserve_경쟁에서도_상한을_넘지_않는다() throws Exception {
    int threads = 32;
    ExecutorService pool = Executors.newFixedThreadPool(threads);
    CountDownLatch go = new CountDownLatch(1);
    AtomicInteger ok = new AtomicInteger();
    List<Future<?>> fs = new ArrayList<>();
    for (int i = 0; i < threads; i++) {
      String key = "s" + i;
      fs.add(
          pool.submit(
              () -> {
                go.await();
                try {
                  registry.reserve(1L, tag(key), 3);
                  ok.incrementAndGet();
                } catch (StreamingGenerationRejectedException ignored) {
                  // 상한 초과 — 기대된 거절
                }
                return null;
              }));
    }
    go.countDown();
    for (Future<?> f : fs) f.get(2, TimeUnit.SECONDS);
    pool.shutdown();
    assertThat(ok.get()).isEqualTo(3);
    assertThat(registry.active(1L, "home")).hasSize(3);
  }

  @Test
  void launch_가_거절되면_예약을_반납하고_예외를_던진다() {
    Reservation r = registry.reserve(1L, tag("s-a"), 3);
    TaskExecutorAdapter full =
        new TaskExecutorAdapter(
            task -> {
              throw new TaskRejectedException("full");
            });
    assertThatThrownBy(() -> registry.launch(r, full, Duration.ofSeconds(10), () -> {}, () -> {}))
        .isInstanceOf(TaskRejectedException.class);
    assertThat(registry.active(1L, "home")).isEmpty();
  }

  /** 인터럽트에 응답하지 않는 태스크라도 취소 후 유예가 지나면 슬롯을 돌려준다(하드 상한 누수 방지). */
  @Test
  void 취소에_응답하지_않는_태스크도_유예_뒤_슬롯을_반납한다() throws InterruptedException {
    DefaultStreamingGenerationRegistry fast =
        new DefaultStreamingGenerationRegistry(Duration.ofMillis(100));
    ThreadPoolTaskExecutor executor = realExecutor();
    CountDownLatch started = new CountDownLatch(1);
    CountDownLatch stuck = new CountDownLatch(1);
    Reservation r = fast.reserve(1L, tag("s-a"), 3);
    fast.launch(
        r,
        executor,
        Duration.ofSeconds(10),
        () -> {
          started.countDown();
          // 인터럽트를 무시하고 계속 붙잡는다.
          while (stuck.getCount() > 0) {
            try {
              stuck.await();
            } catch (InterruptedException ignored) {
              // 무시
            }
          }
        },
        () -> {});
    assertThat(started.await(1, TimeUnit.SECONDS)).isTrue();
    fast.cancel(r.correlationId(), 1L);
    awaitTrue(() -> fast.active(1L, "home").isEmpty());
    stuck.countDown();
    executor.shutdown();
    fast.shutdown();
  }

  /** reserve 와 launch 사이의 취소는 launch 가 종결 콜백을 정확히 한 번 부르고, 제출하지 않으며, 슬롯은 이미 비어 있다. */
  @Test
  void reserve_와_launch_사이_취소는_launch_가_종결_콜백을_한번_부른다() {
    Reservation r = registry.reserve(1L, tag("s-a"), 3);
    registry.cancel(r.correlationId(), 1L);
    assertThat(registry.active(1L, "home")).isEmpty();
    assertThat(r.cancelReason()).isEqualTo(CancelReason.USER);

    AtomicInteger aborted = new AtomicInteger();
    AtomicInteger submitted = new AtomicInteger();
    TaskExecutorAdapter counting =
        new TaskExecutorAdapter(
            task -> {
              submitted.incrementAndGet();
              task.run();
            });
    AtomicBoolean ran = new AtomicBoolean(false);
    registry.launch(
        r, counting, Duration.ofSeconds(10), () -> ran.set(true), aborted::incrementAndGet);

    assertThat(aborted.get()).isEqualTo(1);
    assertThat(submitted.get()).isZero();
    assertThat(ran.get()).isFalse();
    assertThat(registry.active(1L, "home")).isEmpty();
  }

  /** launch 이후 큐 대기 중 취소(콜백 등록 후 순서)에서도 정확히 한 번만 불린다. */
  @Test
  void launch_후_큐_대기_중_취소도_콜백은_정확히_한번() throws InterruptedException {
    ThreadPoolTaskExecutor single = new ThreadPoolTaskExecutor();
    single.setCorePoolSize(1);
    single.setMaxPoolSize(1);
    single.initialize();
    CountDownLatch blocker = new CountDownLatch(1);
    single.submit(
        () -> {
          try {
            blocker.await();
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
        });
    AtomicInteger aborted = new AtomicInteger();
    Reservation r = registry.reserve(1L, tag("s-b"), 3);
    registry.launch(r, single, Duration.ofSeconds(10), () -> {}, aborted::incrementAndGet);
    registry.cancel(r.correlationId(), 1L);
    blocker.countDown();
    single.shutdown();
    assertThat(aborted.get()).isEqualTo(1);
  }
}
