package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.global.exception.StreamingGenerationForbiddenException;
import com.workplace.global.exception.StreamingGenerationNotFoundException;
import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
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
}
