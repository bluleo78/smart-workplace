package com.workplace.global.realtime;

import com.workplace.global.exception.StreamingGenerationForbiddenException;
import com.workplace.global.exception.StreamingGenerationNotFoundException;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Component;

/** {@link StreamingGenerationRegistry} 기본 구현 — in-memory, 단일 노드. */
@Component
public class DefaultStreamingGenerationRegistry implements StreamingGenerationRegistry {

  private final ConcurrentHashMap<String, GenerationHandle> generations = new ConcurrentHashMap<>();
  // 타임아웃 스케줄만 담당하는 경량 단일 스레드 — 실제 생성 태스크는 도메인별 전용 executor 에서 실행된다.
  private final ScheduledExecutorService timeoutScheduler =
      Executors.newSingleThreadScheduledExecutor();

  @Override
  public String start(
      long ownerUserId,
      AsyncTaskExecutor executor,
      Duration timeout,
      Function<String, Runnable> taskFactory) {
    String correlationId = UUID.randomUUID().toString();
    GenerationHandle handle = new GenerationHandle(ownerUserId);
    generations.put(correlationId, handle);

    Runnable task = taskFactory.apply(correlationId);
    handle.future =
        executor.submit(
            () -> {
              try {
                task.run();
              } finally {
                // 정상/예외 종료 모두 여기서 자기 자신을 제거 — 취소(cancel)나 타임아웃이 이미 제거했으면 no-op.
                GenerationHandle removed = generations.remove(correlationId);
                if (removed != null && removed.timeoutFuture != null) {
                  removed.timeoutFuture.cancel(false);
                }
              }
            });
    handle.timeoutFuture =
        timeoutScheduler.schedule(
            () -> {
              GenerationHandle h = generations.remove(correlationId);
              if (h != null && h.future != null) {
                h.future.cancel(true);
              }
            },
            timeout.toMillis(),
            TimeUnit.MILLISECONDS);
    return correlationId;
  }

  @Override
  public void cancel(String correlationId, long callerId) {
    GenerationHandle handle = generations.get(correlationId);
    if (handle == null) {
      throw new StreamingGenerationNotFoundException(correlationId);
    }
    if (handle.ownerUserId != callerId) {
      throw new StreamingGenerationForbiddenException(correlationId);
    }
    if (handle.timeoutFuture != null) {
      handle.timeoutFuture.cancel(false);
    }
    if (handle.future != null) {
      handle.future.cancel(true);
    }
  }

  @PreDestroy
  void shutdown() {
    timeoutScheduler.shutdownNow();
  }

  /** 진행 중인 생성 1건의 소유자·취소 핸들. future/timeoutFuture 는 start() 내부에서 순차 대입되므로 volatile 로 가시성 보장. */
  private static final class GenerationHandle {
    final long ownerUserId;
    volatile Future<?> future;
    volatile ScheduledFuture<?> timeoutFuture;

    GenerationHandle(long ownerUserId) {
      this.ownerUserId = ownerUserId;
    }
  }
}
