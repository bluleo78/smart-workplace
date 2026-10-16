package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

class SseRegistryTest {

  private final SseRegistry registry = new SseRegistry(new ObjectMapper());

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
