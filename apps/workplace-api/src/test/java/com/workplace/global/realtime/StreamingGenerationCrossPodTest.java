package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.global.exception.StreamingGenerationForbiddenException;
import com.workplace.global.exception.StreamingGenerationNotFoundException;
import com.workplace.global.exception.StreamingGenerationRejectedException;
import com.workplace.global.exception.StreamingGenerationRejectedException.Reason;
import com.workplace.global.realtime.StreamingGenerationRegistry.ActiveGeneration;
import com.workplace.global.realtime.StreamingGenerationRegistry.CancelReason;
import com.workplace.global.realtime.StreamingGenerationRegistry.GenerationTag;
import com.workplace.global.realtime.StreamingGenerationRegistry.Reservation;
import com.workplace.global.realtime.relay.RelayLocalDispatcher;
import com.workplace.global.realtime.relay.RelayMessage;
import com.workplace.global.realtime.relay.SseEventRelay;
import com.workplace.jooq.Tables;
import com.workplace.support.IntegrationTestBase;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/**
 * 파드 사이 AI 생성 상태 공유 검증(WP-1974) — 같은 DB 슬롯 저장소를 쓰는 두 레지스트리(파드 A·B)가 BUSY/LIMIT·진행 목록을 함께 보고, B 로 간
 * 취소가 중계를 거쳐 A 에서 도는 생성을 멈추는지 확인한다.
 */
class StreamingGenerationCrossPodTest extends IntegrationTestBase {

  @Autowired JooqGenerationSlotStore store;
  @Autowired DSLContext dsl;

  /** 테스트 간 충돌을 피하는 큰 랜덤 owner. */
  private final long owner = 2_000_000_000L + ThreadLocalRandom.current().nextLong(1_000_000_000L);

  private BroadcastRelay relay;
  private DefaultStreamingGenerationRegistry podA;
  private DefaultStreamingGenerationRegistry podB;
  private ThreadPoolTaskExecutor executor;

  /** 모든 수신자(파드)에게 동기로 넘기는 테스트용 중계 — 운영의 NOTIFY 가 모든 파드에 닿는 것을 한 JVM 안에서 흉내 낸다. */
  static final class BroadcastRelay implements SseEventRelay {
    final List<Consumer<RelayMessage>> receivers = new CopyOnWriteArrayList<>();

    /** 보낸 메시지 — 중계하지 말아야 할 때 아무것도 안 보냈는지 확인한다. */
    final List<RelayMessage> published = new CopyOnWriteArrayList<>();

    @Override
    public void publish(RelayMessage message) {
      published.add(message);
      for (Consumer<RelayMessage> r : receivers) r.accept(message);
    }

    @Override
    public void onMessage(Consumer<RelayMessage> receiver) {
      receivers.add(receiver);
    }
  }

  /** 파드 한 대 — 레지스트리와 그 파드의 로컬 배선(중계 수신 등록)을 만든다. */
  private DefaultStreamingGenerationRegistry newPod() {
    DefaultStreamingGenerationRegistry registry =
        new DefaultStreamingGenerationRegistry(store, relay, Duration.ofSeconds(5));
    new RelayLocalDispatcher(new SseRegistry(relay), new RunnerSseRegistry(relay), registry, relay)
        .register();
    return registry;
  }

  @BeforeEach
  void setUp() {
    relay = new BroadcastRelay();
    podA = newPod();
    podB = newPod();
    executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(2);
    executor.setMaxPoolSize(2);
    executor.initialize();
  }

  @AfterEach
  void tearDown() {
    executor.shutdown();
    // 파드 종료 정리 — 각자 자기 pod_id 행을 지운다.
    podA.shutdown();
    podB.shutdown();
    // 종료 정리는 아직 도는 생성의 행을 남기므로(임대 만료로 사라짐) 이 테스트 소유자의 행을 직접 지운다.
    dsl.deleteFrom(Tables.STREAMING_GENERATION)
        .where(Tables.STREAMING_GENERATION.OWNER_USER_ID.eq(owner))
        .execute();
  }

  private static Reason reasonOf(Runnable call) {
    try {
      call.run();
    } catch (StreamingGenerationRejectedException e) {
      return e.reason();
    }
    throw new AssertionError("거절되지 않았다");
  }

  private static void await(BooleanSupplier condition) throws InterruptedException {
    long deadline = System.currentTimeMillis() + 5_000;
    while (!condition.getAsBoolean()) {
      if (System.currentTimeMillis() > deadline) throw new AssertionError("조건 대기 시간 초과");
      Thread.sleep(20);
    }
  }

  @Test
  void crossPodBusyAndLimit() {
    podA.reserve(owner, new GenerationTag("home", "s1"), 2);
    // 같은 대화(tag)를 다른 파드에서 다시 시작하면 BUSY.
    assertThat(reasonOf(() -> podB.reserve(owner, new GenerationTag("home", "s1"), 2)))
        .isEqualTo(Reason.BUSY);
    // 상한 2 — A 의 s1 · B 의 s2 를 합쳐 세므로 A 의 s3 는 LIMIT.
    podB.reserve(owner, new GenerationTag("home", "s2"), 2);
    assertThat(reasonOf(() -> podA.reserve(owner, new GenerationTag("home", "s3"), 2)))
        .isEqualTo(Reason.LIMIT);
  }

  @Test
  void crossPodActive() {
    Reservation a = podA.reserve(owner, new GenerationTag("home", "s1"), 5);
    Reservation b = podB.reserve(owner, new GenerationTag("home", "s2"), 5);
    assertThat(podA.active(owner, "home"))
        .extracting(ActiveGeneration::correlationId)
        .containsExactly(a.correlationId(), b.correlationId());
    assertThat(podB.active(owner, "home"))
        .extracting(ActiveGeneration::correlationId)
        .containsExactly(a.correlationId(), b.correlationId());
  }

  @Test
  void crossPodCancel_stopsRunningTask() throws InterruptedException {
    Reservation r = podA.reserve(owner, new GenerationTag("home", "s1"), 5);
    CountDownLatch started = new CountDownLatch(1);
    AtomicBoolean interrupted = new AtomicBoolean(false);
    podA.launch(
        r,
        executor,
        Duration.ofMinutes(1),
        () -> {
          started.countDown();
          try {
            Thread.sleep(60_000);
          } catch (InterruptedException e) {
            interrupted.set(true);
          }
        },
        () -> {});
    assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();

    // 취소 요청이 생성이 돌지 않는 파드 B 로 갔다 — 중계로 A 에 전달돼야 한다.
    podB.cancel(r.correlationId(), owner);

    await(interrupted::get);
    assertThat(r.cancelReason()).isEqualTo(CancelReason.USER);
    // 태스크 종결 경로(래퍼 finally)가 반납하면 공유 행도 사라진다.
    await(() -> store.find(r.correlationId()).isEmpty());
  }

  @Test
  void crossPodCancel_beforeLaunch_abortsOnce() {
    Reservation r = podA.reserve(owner, new GenerationTag("home", "s1"), 5);
    podB.cancel(r.correlationId(), owner);

    AtomicInteger aborted = new AtomicInteger();
    AtomicBoolean ran = new AtomicBoolean(false);
    podA.launch(r, executor, Duration.ofMinutes(1), () -> ran.set(true), aborted::incrementAndGet);

    assertThat(aborted.get()).isEqualTo(1);
    assertThat(ran.get()).isFalse();
    assertThat(store.find(r.correlationId())).isEmpty();
  }

  @Test
  void crossPodCancel_wrongOwner_forbidden_unknown_notFound() {
    Reservation r = podA.reserve(owner, new GenerationTag("home", "s1"), 5);
    assertThatThrownBy(() -> podB.cancel(r.correlationId(), owner + 1))
        .isInstanceOf(StreamingGenerationForbiddenException.class);
    assertThatThrownBy(() -> podB.cancel("no-such-" + owner, owner))
        .isInstanceOf(StreamingGenerationNotFoundException.class);
    // 거절된 취소는 생성을 건드리지 않는다.
    assertThat(r.cancelReason()).isNull();
    assertThat(store.find(r.correlationId()).map(GenerationSlot::ownerUserId)).hasValue(owner);
  }

  /** 같은 파드 취소는 로컬 핸들이 우선 — 공유 행이 사라진 뒤에도(DB 오류·임대 만료 정리) 실행 중 생성을 멈춘다. */
  @Test
  void localCancel_worksAfterStoreRowGone() throws InterruptedException {
    Reservation r = podA.reserve(owner, new GenerationTag("home", "s1"), 5);
    CountDownLatch started = new CountDownLatch(1);
    AtomicBoolean interrupted = new AtomicBoolean(false);
    podA.launch(
        r,
        executor,
        Duration.ofMinutes(1),
        () -> {
          started.countDown();
          try {
            Thread.sleep(60_000);
          } catch (InterruptedException e) {
            interrupted.set(true);
          }
        },
        () -> {});
    assertThat(started.await(5, TimeUnit.SECONDS)).isTrue();

    store.remove(r.correlationId());
    podA.cancel(r.correlationId(), owner);

    await(interrupted::get);
    assertThat(r.cancelReason()).isEqualTo(CancelReason.USER);
  }

  /** 로컬 경로에서도 소유자가 다르면 403 — 생성은 건드리지 않는다. */
  @Test
  void localCancel_wrongOwner_forbidden() {
    Reservation r = podA.reserve(owner, new GenerationTag("home", "s1"), 5);
    store.remove(r.correlationId());
    assertThatThrownBy(() -> podA.cancel(r.correlationId(), owner + 1))
        .isInstanceOf(StreamingGenerationForbiddenException.class);
    assertThat(r.cancelReason()).isNull();
  }

  /**
   * 파드 종료 정리는 아직 도는 생성(로컬 핸들)의 행을 남기고, 핸들이 없는 자기 파드 행만 지운다 — graceful 종료 동안 끝까지 도는 생성을 다른 파드가 BUSY
   * 없이 겹쳐 시작하지 않게.
   */
  @Test
  void shutdown_keepsRunningRows_removesStaleOwnRows() {
    Reservation running = podA.reserve(owner, new GenerationTag("home", "s1"), 5);
    String stale = "stale-" + owner;
    store.reserve(
        owner,
        new GenerationTag("home", "s2"),
        5,
        stale,
        podA.podId(),
        java.time.Instant.now().plus(Duration.ofMinutes(5)));
    assertThat(podB.active(owner, "home")).hasSize(2);

    podA.shutdown();

    assertThat(podB.active(owner, "home"))
        .extracting(ActiveGeneration::correlationId)
        .containsExactly(running.correlationId());
  }

  /** 핸들 없이 이 파드 이름으로 남은 행(낡은 행)에 대한 취소는 중계하지 않고 행을 지운 뒤 404 다. */
  @Test
  void cancel_staleRowOfThisPod_removesRowAndNotFound() {
    String stale = "stale-" + owner;
    store.reserve(
        owner,
        new GenerationTag("home", "s1"),
        5,
        stale,
        podA.podId(),
        java.time.Instant.now().plus(Duration.ofMinutes(5)));

    assertThatThrownBy(() -> podA.cancel(stale, owner))
        .isInstanceOf(StreamingGenerationNotFoundException.class);
    assertThat(store.find(stale)).isEmpty();
    assertThat(relay.published).isEmpty();
  }
}
