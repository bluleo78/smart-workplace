package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.global.realtime.relay.NoopSseEventRelay;
import com.workplace.global.realtime.relay.RelayLocalDispatcher;
import com.workplace.global.realtime.relay.RelayMessage;
import com.workplace.global.realtime.relay.SseEventRelay;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class SseRegistryTest {

  /** 중계 끄기(Noop) 상태 — 발행이 로컬 수신자로 곧바로 돌아 fanOut·closeAll 이 실제 emitter 로 끝난다. */
  private final NoopSseEventRelay relay = new NoopSseEventRelay();

  private final SseRegistry registry = new SseRegistry(relay);

  /** 로컬 배선 — 운영에서는 RelayLocalDispatcher 의 @PostConstruct 가 startup 에 부른다. */
  private final RelayLocalDispatcher dispatcher =
      new RelayLocalDispatcher(registry, new RunnerSseRegistry(relay), relay);

  @BeforeEach
  void registerLocalDispatch() {
    dispatcher.register();
  }

  /** emitter 가 서버 쪽에서 닫혔는지 — 닫힌 emitter 에 보내면 IllegalStateException. */
  private static boolean isClosed(SseEmitter emitter) {
    try {
      emitter.send(SseEmitter.event().comment("probe"));
      return false;
    } catch (IllegalStateException e) {
      return true;
    } catch (java.io.IOException e) {
      return false;
    }
  }

  /** WP-2008: 키 폐기 시 그 키로 연 스트림만 닫는다 — 같은 사용자의 다른 키·JWT 연결은 그대로. */
  @Test
  void closeByKey_closesOnlyThatKeysStreams() {
    SseEmitter k101 = registry.register(7L, 101L);
    SseEmitter k102 = registry.register(7L, 102L);
    SseEmitter jwt = registry.register(7L, null);

    registry.closeByKey(101L);

    assertThat(isClosed(k101)).isTrue();
    assertThat(isClosed(k102)).isFalse();
    assertThat(isClosed(jwt)).isFalse();
    assertThat(registry.connectedUserCount()).isEqualTo(1);
    assertThat(registry.openAgentKeyIds()).containsExactly(102L);
  }

  /** WP-2008: 활성 키 집합에 없는 키의 스트림을 모두 닫고 닫은 수를 돌려준다. */
  @Test
  void closeInactiveKeys_closesKeysNotActive() {
    SseEmitter inactive = registry.register(7L, 101L);
    SseEmitter active = registry.register(8L, 201L);

    int closed = registry.closeInactiveKeys(Set.of(101L, 201L), Set.of(201L));

    assertThat(closed).isEqualTo(1);
    assertThat(isClosed(inactive)).isTrue();
    assertThat(isClosed(active)).isFalse();
    assertThat(registry.openAgentKeyIds()).containsExactly(201L);
  }

  /** WP-2008: 확인 시점 목록에 없던 키(확인 중 새로 열린 스트림)는 활성 목록에 없어도 닫지 않는다. */
  @Test
  void closeInactiveKeys_keepsKeyNotInCheckedSnapshot() {
    SseEmitter checkedInactive = registry.register(7L, 101L);
    SseEmitter opened = registry.register(8L, 301L);

    int closed = registry.closeInactiveKeys(Set.of(101L), Set.of());

    assertThat(closed).isEqualTo(1);
    assertThat(isClosed(checkedInactive)).isTrue();
    assertThat(isClosed(opened)).isFalse();
    assertThat(registry.openAgentKeyIds()).containsExactly(301L);
  }

  /** WP-2008: 키 없이 연 스트림(JWT 등)은 안전망이 건드리지 않는다. */
  @Test
  void closeInactiveKeys_ignoresStreamsWithoutKey() {
    SseEmitter jwt = registry.register(7L, null);

    assertThat(registry.closeInactiveKeys(Set.of(), Set.of())).isZero();

    assertThat(isClosed(jwt)).isFalse();
    assertThat(registry.isConnected(7L)).isTrue();
    assertThat(registry.connectedUserCount()).isEqualTo(1);
  }

  /** WP-2008: 끊긴 emitter 의 키 기억이 남지 않는다 — 하트비트 전송 실패로 정리되는 경로. */
  @Test
  void completedEmitter_forgetsKey() {
    SseEmitter e = registry.register(7L, 101L);
    assertThat(registry.openAgentKeyIds()).containsExactly(101L);

    e.complete();
    registry.sendHeartbeat();

    assertThat(registry.openAgentKeyIds()).isEmpty();
  }

  /** WP-2008: 사용자 단위 닫기·한도 초과 퇴출 때도 키 기억이 같이 지워진다. */
  @Test
  void closeAllAndEviction_forgetKeys() {
    registry.register(7L, 101L);
    registry.closeAll(7L);
    assertThat(registry.openAgentKeyIds()).isEmpty();

    // 한도(5) 초과 시 가장 오래된 연결(키 1)이 퇴출된다.
    for (long key = 1; key <= 6; key++) registry.register(9L, key);
    assertThat(registry.openAgentKeyIds()).containsExactlyInAnyOrder(2L, 3L, 4L, 5L, 6L);
  }

  @Test
  void register_returnsEmitterAndCounts() {
    SseEmitter e = registry.register(1L);
    assertThat(e).isNotNull();
    assertThat(registry.connectedUserCount()).isEqualTo(1);
  }

  @Test
  void fanOut_toRegisteredUsersOnly_doesNotThrow() {
    registry.register(1L);
    registry.register(2L);
    // user 3 미등록 → skip. 예외 없이 동작하고 연결 유저 수는 2 유지.
    registry.fanOut(List.of(1L, 3L), "chat.message.created", Map.of("threadId", 5));
    assertThat(registry.connectedUserCount()).isEqualTo(2);
  }

  /**
   * 받을 대상이 없으면 중계로 내지 않는다(WP-1973 리뷰 선택 항목) — 빈 대상 NOTIFY 는 채널 트래픽만 늘리고 아무도 받지 않는다. 대상이 있으면 그때만
   * 발행한다.
   */
  @Test
  void fanOut_빈_대상은_중계로_내지_않는다() {
    SseEventRelay 모의_중계 = mock(SseEventRelay.class);
    SseRegistry 대상 = new SseRegistry(모의_중계);

    대상.fanOut(List.of(), "chat.message.created", Map.of("threadId", 5));
    verifyNoInteractions(모의_중계);

    대상.fanOut(List.of(5L), "chat.message.created", Map.of("threadId", 5));
    verify(모의_중계).publish(any(RelayMessage.class));
  }

  /** WP-420: 멤버십 정지 시 그 유저의 모든 스트림을 닫는다 — 다른 유저 연결은 그대로, 닫힌 유저에게는 더 보내지 않는다. */
  @Test
  void closeAll_removesOnlyThatUsersEmitters() {
    registry.register(1L);
    registry.register(1L);
    registry.register(2L);

    registry.closeAll(1L);

    assertThat(registry.connectedUserCount()).isEqualTo(1);
    // 닫힌 유저에게 fanOut 해도 예외 없이 skip, 재연결하면 새 스트림이 정상 등록된다.
    registry.fanOut(List.of(1L, 2L), "chat.message.created", Map.of("threadId", 5));
    registry.closeAll(3L); // 미연결 유저는 no-op
    registry.register(1L);
    assertThat(registry.connectedUserCount()).isEqualTo(2);
  }

  /**
   * 발행이 도착하지 않아도 로컬 emitter 는 닫힌다(WP-1973 리뷰) — 중계로만 닫으면 발행 커넥션 끊김·발행 큐 넘침·이 파드 LISTEN 재연결 백오프 동안
   * 로컬 연결이 어느 파드에서도 닫히지 않는다(파드 1대여도 — 보안 토큰 회수가 한 곳에서만 일어난다). 「LISTEN 이 끊긴 동안」의 발행 실패를 중계가 아무것도 하지
   * 않는 상황으로 재현한다.
   */
  @Test
  void closeAll_발행이_도착하지_않아도_로컬을_닫는다() {
    SseEventRelay 끊긴_중계 = mock(SseEventRelay.class); // publish 가 전달을 만들지 않는다 — 끊긴 발행·LISTEN 경로
    SseRegistry 대상 = new SseRegistry(끊긴_중계);
    SseEmitter emitter = 대상.register(1L);

    대상.closeAll(1L);

    assertThat(대상.connectedUserCount()).as("발행과 무관하게 로컬 연결이 정리된다").isZero();
    assertThatThrownBy(() -> emitter.send(SseEmitter.event().comment("probe")))
        .as("로컬 emitter 는 바로 닫힌다")
        .isInstanceOf(IllegalStateException.class);
    verify(끊긴_중계).publish(RelayMessage.closeUser(1L));
  }

  /**
   * WP-420: 재연결(register)과 정지 닫기(closeAll)가 겹쳐도, 등록된 emitter 는 모두 맵에 남아 있거나 닫혀야 한다. 예전에는
   * computeIfAbsent 로 얻은 목록이 closeAll 에 떼어 내진 뒤 add 되면 맵에도 없고 닫히지도 않은 연결이 남아, 마지막 closeAll 로도 닫을 수
   * 없었다.
   */
  @Test
  void registerRacingCloseAll_neverLeavesDetachedOpenEmitter() throws Exception {
    int registerThreads = 4;
    int perThread = 2_000;
    ConcurrentLinkedQueue<SseEmitter> registered = new ConcurrentLinkedQueue<>();
    AtomicBoolean done = new AtomicBoolean(false);
    CountDownLatch start = new CountDownLatch(1);
    ExecutorService pool = Executors.newFixedThreadPool(registerThreads + 1);
    try {
      pool.submit(
          () -> {
            start.await();
            while (!done.get()) registry.closeAll(1L);
            return null;
          });
      CountDownLatch finished = new CountDownLatch(registerThreads);
      for (int t = 0; t < registerThreads; t++) {
        pool.submit(
            () -> {
              start.await();
              for (int i = 0; i < perThread; i++) registered.add(registry.register(1L));
              finished.countDown();
              return null;
            });
      }
      start.countDown();
      assertThat(finished.await(30, TimeUnit.SECONDS)).isTrue();
      done.set(true);
    } finally {
      pool.shutdown();
      assertThat(pool.awaitTermination(10, TimeUnit.SECONDS)).isTrue();
    }

    // 마지막 closeAll 뒤에는 어떤 emitter 도 열려 있으면 안 된다 — 닫힌 emitter 에 보내면 IllegalStateException.
    registry.closeAll(1L);
    assertThat(registry.connectedUserCount()).isZero();
    for (SseEmitter emitter : registered) {
      assertThatThrownBy(() -> emitter.send(SseEmitter.event().comment("probe")))
          .isInstanceOf(IllegalStateException.class);
    }
  }
}
