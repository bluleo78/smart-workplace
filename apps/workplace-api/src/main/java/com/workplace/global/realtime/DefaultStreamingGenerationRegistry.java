package com.workplace.global.realtime;

import com.workplace.global.exception.StreamingGenerationForbiddenException;
import com.workplace.global.exception.StreamingGenerationNotFoundException;
import com.workplace.global.exception.StreamingGenerationRejectedException;
import com.workplace.global.exception.StreamingGenerationRejectedException.Reason;
import com.workplace.global.realtime.relay.RelayMessage;
import com.workplace.global.realtime.relay.SseEventRelay;
import jakarta.annotation.PreDestroy;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.stereotype.Component;

/**
 * {@link StreamingGenerationRegistry} 기본 구현.
 *
 * <p>WP-1974: 상태 판정(BUSY/LIMIT·진행 목록·취소 소유자)은 {@link GenerationSlotStore}(운영은 DB 표)로 모든 파드가 함께 보고,
 * 실행 핸들(Future·타임아웃·CAS)은 생성을 시작한 파드의 메모리에만 둔다. 취소가 핸들이 없는 파드로 오면 중계({@link SseEventRelay})의 {@code
 * generation.cancel} 로 생성이 도는 파드에 넘긴다. 기본 생성자(단위 테스트)는 메모리 저장소 + 중계 없음으로 단일 노드 동작 그대로다.
 *
 * <p>WP-190: 태그 예약(reserve)으로 "확인 + 등록" 을 원자화하고, 시작 전 취소와 실행 시작을 {@code claimed} CAS 로 경합시킨다 — 취소가
 * 이기면 태스크는 실행되지 않고 즉시 반납, 실행이 이기면 태스크 자신의 종결 경로가 반납한다(실행 중 슬롯을 먼저 지우면 ■ 직후 재전송한 새 질문 뒤에 이전 턴의 부분
 * 답변이 저장되는 순서 역전이 생긴다).
 */
@Slf4j
@Component
public class DefaultStreamingGenerationRegistry implements StreamingGenerationRegistry {

  /** 실행 중 취소 뒤에도 태스크가 인터럽트에 응답하지 않을 때 슬롯을 강제 반납하기까지의 기본 유예. */
  static final Duration STUCK_RELEASE_GRACE = Duration.ofSeconds(30);

  /** reserve 뒤 launch 전까지의 임대 — launch 가 오지 않고 파드가 죽어도 이 시간 뒤엔 다른 파드의 판정을 막지 않는다. */
  static final Duration RESERVE_LEASE = Duration.ofMinutes(5);

  /** launch 때 만료를 「타임아웃 + 강제 반납 유예」 보다 이만큼 더 둔다 — 정상 종결(행 삭제)이 늘 만료보다 먼저 오게. */
  static final Duration RUN_LEASE_MARGIN = Duration.ofMinutes(1);

  private final Duration stuckReleaseGrace;
  private final GenerationSlotStore store;

  /** 중계 — null 이면(단위 테스트) 다른 파드로 취소를 넘기지 않는다. */
  private final SseEventRelay relay;

  /** 이 인스턴스(파드)의 식별자 — 슬롯 행에 적어 종료 때 자기 행만 지운다. */
  private final String podId = UUID.randomUUID().toString();

  /** 이 파드에서 시작한 생성의 실행 핸들 — 상태 판정은 store, 실행 제어는 여기. */
  private final ConcurrentHashMap<String, GenerationHandle> generations = new ConcurrentHashMap<>();

  // 타임아웃 스케줄만 담당하는 경량 단일 스레드 — 실제 생성 태스크는 도메인별 전용 executor 에서 실행된다.
  private final ScheduledExecutorService timeoutScheduler = newTimeoutScheduler();

  /**
   * 타임아웃 스케줄러 — 단일 스레드에 removeOnCancel 을 켠다. 기본값(false)이면 종결로 취소한 타임아웃 태스크가 예정 시각까지 큐에 남아 핸들 → 시작 전
   * 취소 콜백 → 스트리밍 텍스트를 붙든다(턴마다 최대 타임아웃만큼 메모리 보유).
   */
  private static ScheduledExecutorService newTimeoutScheduler() {
    ScheduledThreadPoolExecutor scheduler = new ScheduledThreadPoolExecutor(1);
    scheduler.setRemoveOnCancelPolicy(true);
    return scheduler;
  }

  /** 단위 테스트·단일 노드용 — 메모리 저장소, 중계 없음, 기본 유예(30초). */
  public DefaultStreamingGenerationRegistry() {
    this(STUCK_RELEASE_GRACE);
  }

  /** 테스트용 — 유예를 짧게 주입해 강제 반납을 검증한다(메모리 저장소, 중계 없음). */
  DefaultStreamingGenerationRegistry(Duration stuckReleaseGrace) {
    this(new InMemoryGenerationSlotStore(), null, stuckReleaseGrace);
  }

  /** 스프링 빈 — 공유 슬롯 저장소(DB)와 파드 사이 중계, 기본 유예(30초). */
  @Autowired
  public DefaultStreamingGenerationRegistry(GenerationSlotStore store, SseEventRelay relay) {
    this(store, relay, STUCK_RELEASE_GRACE);
  }

  /** 테스트용 — 저장소·중계를 주입하고 유예를 짧게 줄 수 있다(파드 사이 통합 테스트). */
  DefaultStreamingGenerationRegistry(
      GenerationSlotStore store, SseEventRelay relay, Duration stuckReleaseGrace) {
    this.store = store;
    this.relay = relay;
    this.stuckReleaseGrace = stuckReleaseGrace;
  }

  @Override
  public String start(
      long ownerUserId,
      AsyncTaskExecutor executor,
      Duration timeout,
      Function<String, Runnable> taskFactory) {
    // 태그 없는 생성(wiki·drive) — 상한·BUSY 판정 없이 슬롯만 등록한다(취소 소유자 판정·다른 파드 취소용).
    GenerationHandle handle = register(ownerUserId, null, 0, null);
    // wiki·drive 는 시작 전 취소 시 알릴 대상이 없다(웹이 요청 단위로 구독을 정리).
    launch(handle, executor, timeout, taskFactory.apply(handle.correlationId), () -> {});
    return handle.correlationId;
  }

  @Override
  public Reservation reserve(
      long ownerUserId, GenerationTag tag, int perUserLimit, String requestedCorrelationId) {
    // id 겹침·BUSY·LIMIT 판정과 등록은 저장소가 원자적으로 한다(DB 는 소유자 단위 advisory 락) — 모든 파드의 생성을 함께 센다.
    return register(ownerUserId, tag, perUserLimit, requestedCorrelationId);
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
    // 제출 전에 실행 동안의 임대로 늘린다 — 타임아웃·강제 반납 유예가 다 지나도 정상 종결이 먼저 오도록 여유를 더한다. 실패하면 제출하지
    // 않고 반납한 뒤 던진다: 5분 예약 임대인 채로 긴 생성을 돌리면 임대가 먼저 끝나 다른 파드가 같은 대화를 겹쳐 시작하고 상한도 덜 센다.
    // 호출자는 launch 예외를 이미 「반납 + 다시 던짐」으로 처리한다(반납은 멱등).
    try {
      store.extend(
          handle.correlationId,
          Instant.now().plus(timeout).plus(stuckReleaseGrace).plus(RUN_LEASE_MARGIN));
    } catch (RuntimeException e) {
      handle.release();
      throw e;
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
    // 모든 파드의 진행 중 생성 — 새로고침 요청이 어느 파드로 가도 같은 목록을 본다.
    return store.active(ownerUserId, scope);
  }

  @Override
  public void cancel(String correlationId, long callerId) {
    // 같은 파드에서 도는 생성은 로컬 핸들이 우선 — 공유 행이 사라져도(DB 오류·임대 만료 정리) 취소가 듣는다.
    GenerationHandle local = generations.get(correlationId);
    if (local != null) {
      if (local.ownerUserId != callerId) {
        throw new StreamingGenerationForbiddenException(correlationId);
      }
      local.abort(CancelReason.USER);
      return;
    }
    // 핸들이 없으면 존재·소유자 판정은 공유 저장소 기준 — 생성이 다른 파드에서 돌아도 404/403 이 같다.
    Optional<GenerationSlot> slot = store.find(correlationId);
    if (slot.isEmpty()) {
      throw new StreamingGenerationNotFoundException(correlationId);
    }
    // 이 파드 이름의 행인데 핸들이 없다 — 생성은 이미 끝났고 행만 남은 것(반납 중 DB 오류 등). 중계해도 받을 파드가 없으니 행을 지우고 404.
    if (podId.equals(slot.get().podId())) {
      removeQuietly(correlationId, "낡은 생성 슬롯 정리");
      throw new StreamingGenerationNotFoundException(correlationId);
    }
    long owner = slot.get().ownerUserId();
    if (owner != callerId) {
      throw new StreamingGenerationForbiddenException(correlationId);
    }
    // 중계가 없으면(단위 테스트·배선 누락) 다른 파드로 넘길 수 없다 — 조용히 성공하면 웹은 멈췄다고 믿으니 404 로 알린다.
    if (relay == null) {
      log.warn(
          "중계가 없어 다른 파드(pod {})의 생성 취소를 넘기지 못함(correlationId {})",
          slot.get().podId(),
          correlationId);
      throw new StreamingGenerationNotFoundException(correlationId);
    }
    // 이 파드에 핸들이 없다 — 생성이 도는 파드가 받아 멈추도록 중계한다(그 파드의 cancelLocal).
    relay.publish(RelayMessage.generationCancel(correlationId, owner));
  }

  @Override
  public void cancelLocal(String correlationId) {
    GenerationHandle handle = generations.get(correlationId);
    if (handle != null) handle.abort(CancelReason.USER);
  }

  /**
   * 파드 종료 — 타임아웃 스케줄러를 멈추고 이 파드의 슬롯 행 중 로컬 핸들이 없는 것(낡은 행)을 지운다(남기면 임대 만료까지 사용자의 상한을 깎는다). graceful
   * 종료 동안 아직 도는 생성의 행은 남긴다 — 먼저 지우면 다른 파드가 같은 대화를 BUSY 없이 겹쳐 시작한다. 그 행은 자신의 반납이나 임대 만료로 사라진다.
   */
  @PreDestroy
  void shutdown() {
    timeoutScheduler.shutdownNow();
    try {
      store.removeByPod(podId, List.copyOf(generations.keySet()));
    } catch (RuntimeException e) {
      log.warn("파드 종료 중 생성 슬롯 정리 실패(pod {}): {}", podId, e.getMessage());
    }
  }

  /** 이 파드의 식별자 — 파드 사이 테스트가 「이 파드의 낡은 행」을 직접 만들 때 쓴다. */
  String podId() {
    return podId;
  }

  /**
   * 슬롯 등록 — 로컬 핸들 자리를 먼저 잡고(이미 있으면 BUSY) 저장소에 예약한다(거절이면 자리를 비우고 예외). correlationId 가 null 이면 새로
   * 발급한다.
   *
   * <p>로컬 자리를 먼저 잡는 이유: 공유 행이 사라졌어도(임대 만료 정리 등) 이 파드에서 아직 도는 같은 id 의 핸들을 덮으면 그 생성의 취소·종결 추적을 잃는다. 또
   * 행만 있고 핸들이 없는 틈이 없어, 그 사이 취소가 「낡은 행」으로 오판해 행을 지우는 일도 없다.
   */
  private GenerationHandle register(
      long ownerUserId, GenerationTag tag, int perUserLimit, String correlationId) {
    String id = correlationId != null ? correlationId : UUID.randomUUID().toString();
    GenerationHandle handle = new GenerationHandle(id, ownerUserId, tag);
    if (generations.putIfAbsent(id, handle) != null) {
      throw new StreamingGenerationRejectedException(Reason.BUSY);
    }
    Instant leaseEnd = Instant.now().plus(RESERVE_LEASE);
    try {
      if (tag == null) {
        store.registerUntagged(ownerUserId, id, podId, leaseEnd);
      } else {
        store.reserve(ownerUserId, tag, perUserLimit, id, podId, leaseEnd);
      }
    } catch (RuntimeException e) {
      generations.remove(id, handle);
      throw e;
    }
    // 예약하는 사이 취소가 핸들을 이미 반납했다면(반납 때는 아직 행이 없었다) 방금 넣은 행을 지운다 — 임대 만료까지 상한을 깎지 않게.
    if (generations.get(id) != handle) {
      removeQuietly(id, "취소된 예약의 생성 슬롯 정리");
    }
    return handle;
  }

  /** 슬롯 행을 지운다 — 실패해도 호출 흐름을 막지 않고 context(무엇을 하다 실패했는지)와 함께 경고만 남긴다(행은 임대 만료로 정리된다). */
  private void removeQuietly(String correlationId, String context) {
    try {
      store.remove(correlationId);
    } catch (RuntimeException e) {
      log.warn("{} 실패(correlationId {}): {}", context, correlationId, e.getMessage());
    }
  }

  /** 진행 중인 생성 1건의 소유자·태그·취소 핸들. future/timeoutFuture 는 launch 에서 순차 대입되므로 volatile. */
  private final class GenerationHandle implements Reservation {
    final String correlationId;
    final long ownerUserId;
    final GenerationTag tag;

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

    GenerationHandle(String correlationId, long ownerUserId, GenerationTag tag) {
      this.correlationId = correlationId;
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
        // 공유 행도 지운다 — 실패해도 종결 경로를 막지 않고 경고만.
        removeQuietly(correlationId, "생성 슬롯 반납");
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
