package com.workplace.global.realtime;

import com.workplace.global.exception.StreamingGenerationForbiddenException;
import com.workplace.global.exception.StreamingGenerationNotFoundException;
import com.workplace.global.exception.StreamingGenerationRejectedException;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * {@link StreamingGenerationRegistry} 기본 구현 — in-memory, 단일 노드.
 *
 * <p>WP-190: 태그 예약(reserve)으로 "확인 + 등록" 을 원자화하고, 시작 전 취소와 실행 시작을 {@code claimed} CAS 로 경합시킨다 — 취소가
 * 이기면 태스크는 실행되지 않고 즉시 반납, 실행이 이기면 태스크 자신의 종결 경로가 반납한다(실행 중 슬롯을 먼저 지우면 ■ 직후 재전송한 새 질문 뒤에 이전 턴의 부분
 * 답변이 저장되는 순서 역전이 생긴다).
 */
@Component
public class DefaultStreamingGenerationRegistry implements StreamingGenerationRegistry {

  /** 실행 중 취소 뒤에도 태스크가 인터럽트에 응답하지 않을 때 슬롯을 강제 반납하기까지의 기본 유예. */
  static final Duration STUCK_RELEASE_GRACE = Duration.ofSeconds(30);

  private final Duration stuckReleaseGrace;
  private final ConcurrentHashMap<String, GenerationHandle> generations = new ConcurrentHashMap<>();
  // 타임아웃 스케줄만 담당하는 경량 단일 스레드 — 실제 생성 태스크는 도메인별 전용 executor 에서 실행된다.
  private final ScheduledExecutorService timeoutScheduler = newTimeoutScheduler();
  // reserve 의 "검사 + 등록" 을 묶는 락 — 동시 요청이 함께 상한을 넘지 않게. 호출이 드물고 짧아 전역 락으로 충분하다.
  private final Object reserveLock = new Object();

  /**
   * 타임아웃 스케줄러 — 단일 스레드에 removeOnCancel 을 켠다. 기본값(false)이면 종결로 취소한 타임아웃 태스크가 예정 시각까지 큐에 남아 핸들 → 시작 전
   * 취소 콜백 → 스트리밍 텍스트를 붙든다(턴마다 최대 타임아웃만큼 메모리 보유).
   */
  private static ScheduledExecutorService newTimeoutScheduler() {
    ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(1);
    scheduler.setRemoveOnCancelPolicy(true);
    return scheduler;
  }

  /** 스프링 빈 — 기본 유예(30초). */
  public DefaultStreamingGenerationRegistry() {
    this(STUCK_RELEASE_GRACE);
  }

  /** 테스트용 — 유예를 짧게 주입해 강제 반납을 검증한다. */
  DefaultStreamingGenerationRegistry(Duration stuckReleaseGrace) {
    this.stuckReleaseGrace = stuckReleaseGrace;
  }

  @Override
  public String start(
      long ownerUserId,
      AsyncTaskExecutor executor,
      Duration timeout,
      Function<String, Runnable> taskFactory) {
    GenerationHandle handle = register(ownerUserId, null);
    // wiki·drive 는 시작 전 취소 시 알릴 대상이 없다(웹이 요청 단위로 구독을 정리).
    launch(handle, executor, timeout, taskFactory.apply(handle.correlationId), () -> {});
    return handle.correlationId;
  }

  @Override
  public Reservation reserve(long ownerUserId, GenerationTag tag, int perUserLimit) {
    synchronized (reserveLock) {
      int running = 0;
      for (GenerationHandle h : generations.values()) {
        if (h.ownerUserId != ownerUserId || h.tag == null || !h.tag.scope().equals(tag.scope())) {
          continue;
        }
        if (h.tag.key().equals(tag.key())) {
          throw new StreamingGenerationRejectedException(
              StreamingGenerationRejectedException.Reason.BUSY);
        }
        running++;
      }
      if (running >= perUserLimit) {
        throw new StreamingGenerationRejectedException(
            StreamingGenerationRejectedException.Reason.LIMIT);
      }
      return register(ownerUserId, tag);
    }
  }

  @Override
  public void launch(
      Reservation reservation,
      AsyncTaskExecutor executor,
      Duration timeout,
      Runnable task,
      Runnable onAbortedBeforeStart) {
    GenerationHandle handle = (GenerationHandle) reservation;
    handle.onAbortedBeforeStart = onAbortedBeforeStart;
    // reserve 와 launch 사이에 취소가 이미 들어왔다면(abort 가 콜백 대입 전에 CAS 를 이김) 제출하지 않고 여기서 종결을 알린다.
    // abort 와 launch 가 서로의 volatile 쓰기를 최소 한쪽은 보므로, 어느 쪽이 나중이든 콜백은 한 번만 불린다.
    if (handle.claimed.get()) {
      handle.notifyAbortedOnce();
      return;
    }
    try {
      handle.future =
          executor.submit(
              () -> {
                // 취소가 먼저 잡았으면(시작 전 취소) 실행하지 않는다 — 반납은 취소 쪽이 이미 했다.
                if (!handle.claimed.compareAndSet(false, true)) return;
                try {
                  task.run();
                } finally {
                  // 안전망 — 태스크가 종결 경로에서 이미 반납했으면 no-op.
                  handle.release();
                }
              });
    } catch (RuntimeException e) {
      // executor 포화 등 — 새는 슬롯은 사용자 상한을 영구히 깎으므로 반드시 반납.
      handle.release();
      throw e;
    }
    handle.timeoutFuture =
        timeoutScheduler.schedule(
            () -> handle.abort(CancelReason.TIMEOUT), timeout.toMillis(), TimeUnit.MILLISECONDS);
  }

  @Override
  public List<ActiveGeneration> active(long ownerUserId, String scope) {
    return generations.values().stream()
        .filter(h -> h.ownerUserId == ownerUserId && h.tag != null && h.tag.scope().equals(scope))
        .sorted(Comparator.comparing((GenerationHandle h) -> h.startedAt))
        .map(h -> new ActiveGeneration(h.correlationId, h.tag.key(), h.startedAt))
        .toList();
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
    handle.abort(CancelReason.USER);
  }

  @PreDestroy
  void shutdown() {
    timeoutScheduler.shutdownNow();
  }

  private GenerationHandle register(long ownerUserId, GenerationTag tag) {
    GenerationHandle handle = new GenerationHandle(ownerUserId, tag);
    generations.put(handle.correlationId, handle);
    return handle;
  }

  /** 진행 중인 생성 1건의 소유자·태그·취소 핸들. future/timeoutFuture 는 launch 에서 순차 대입되므로 volatile. */
  private final class GenerationHandle implements Reservation {
    final String correlationId = UUID.randomUUID().toString();
    final long ownerUserId;
    final GenerationTag tag;
    final Instant startedAt = Instant.now();

    /** 실행 시작과 시작 전 취소의 경합 표식 — 먼저 잡은 쪽이 이긴다. */
    final AtomicBoolean claimed = new AtomicBoolean(false);

    volatile Future<?> future;
    volatile ScheduledFuture<?> timeoutFuture;
    volatile CancelReason cancelReason;

    /** 강제 반납 예약 — 정상 종료(release)하면 취소해 30초 동안 핸들을 붙잡지 않게 한다. */
    volatile ScheduledFuture<?> stuckReleaseFuture;

    /** launch 전에는 null — 그 사이 취소는 launch 가 대신 알린다. */
    volatile Runnable onAbortedBeforeStart;

    /** 시작 전 취소 콜백을 한 번만 부르기 위한 표식(abort·launch 양쪽이 시도). */
    final AtomicBoolean notified = new AtomicBoolean(false);

    GenerationHandle(long ownerUserId, GenerationTag tag) {
      this.ownerUserId = ownerUserId;
      this.tag = tag;
    }

    @Override
    public String correlationId() {
      return correlationId;
    }

    @Override
    public CancelReason cancelReason() {
      return cancelReason;
    }

    @Override
    public void release() {
      if (generations.remove(correlationId, this)) {
        ScheduledFuture<?> t = timeoutFuture;
        if (t != null) t.cancel(false);
        ScheduledFuture<?> stuck = stuckReleaseFuture;
        if (stuck != null) stuck.cancel(false);
      }
    }

    /** 콜백이 등록돼 있고 아직 안 불렸으면 한 번 호출. 미등록이면 이후 launch 가 호출한다. */
    void notifyAbortedOnce() {
      Runnable cb = onAbortedBeforeStart;
      if (cb != null && notified.compareAndSet(false, true)) cb.run();
    }

    /**
     * 취소(사용자·타임아웃). 시작 전이면 즉시 반납하고 onAbortedBeforeStart 로 종결을 알린다. 실행 중이면 인터럽트만 하고 반납은 태스크 종결에 맡기되,
     * 인터럽트에 응답하지 않는 태스크 대비 유예 후 강제 반납을 예약한다(정상 종료했으면 그때 no-op).
     */
    void abort(CancelReason reason) {
      if (generations.get(correlationId) != this) return; // 이미 끝남
      if (cancelReason == null) cancelReason = reason;
      ScheduledFuture<?> t = timeoutFuture;
      if (t != null && reason != CancelReason.TIMEOUT) t.cancel(false);
      Future<?> f = future;
      if (f != null) f.cancel(true);
      if (claimed.compareAndSet(false, true)) {
        // 실행 전 취소 — 래퍼가 돌지 않으므로 여기서 반납하고, 태스크 대신 종결을 알린다.
        release();
        notifyAbortedOnce();
        return;
      }
      stuckReleaseFuture =
          timeoutScheduler.schedule(
              this::release, stuckReleaseGrace.toMillis(), TimeUnit.MILLISECONDS);
    }
  }
}
