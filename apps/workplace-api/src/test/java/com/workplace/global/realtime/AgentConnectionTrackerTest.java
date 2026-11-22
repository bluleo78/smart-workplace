package com.workplace.global.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import tools.jackson.databind.json.JsonMapper;

/** AgentConnectionTracker 단위 테스트 — 진짜 SseRegistry 와 목 저장소로 쓰기 시점·재시도·잊기를 확인한다. */
class AgentConnectionTrackerTest {

  private static final long ID = 7L;

  private SseRegistry registry;
  private AgentConnectionRepository repository;
  private AgentConnectionTracker tracker;

  @BeforeEach
  void setUp() {
    registry = spy(new SseRegistry(JsonMapper.builder().build()));
    repository = mock(AgentConnectionRepository.class);
    tracker = new AgentConnectionTracker(registry, repository);
  }

  private static Collection<Long> containing(long id) {
    return argThat(c -> c.contains(id));
  }

  @Test
  void connected_writesImmediately() {
    registry.register(ID);
    tracker.connected(ID);
    verify(repository, times(1)).touch(List.of(ID));
  }

  @Test
  void flush_whileConnected_writesEveryTime() {
    registry.register(ID);
    tracker.connected(ID);
    tracker.flush();
    tracker.flush();
    // connected 의 쓰기 1회 + flush 2회 — flush 마다 id 가 들어 있다.
    verify(repository, times(3)).touch(containing(ID));
  }

  @Test
  void flush_afterDisconnect_writesOnceThenForgets() {
    registry.register(ID);
    tracker.connected(ID);
    registry.closeAll(ID);

    tracker.flush();
    verify(repository, times(2)).touch(containing(ID)); // connected + 마지막 flush

    tracker.flush();
    verify(repository, times(2)).touch(anyCollection()); // 잊었으니 더 안 쓴다
  }

  @Test
  void flush_whenFinalWriteFails_forgetsInsteadOfStampingLater() {
    registry.register(ID);
    tracker.connected(ID);
    registry.closeAll(ID);
    doThrow(new RuntimeException("db down")).when(repository).touch(anyCollection());

    tracker.flush(); // 예외 없음

    reset(repository);
    tracker.flush();
    // DB 가 돌아온 뒤에 적으면 한참 전에 끊긴 AI 가 그 시각부터 3분 동안 연결로 보인다.
    verifyNoInteractions(repository);
  }

  @Test
  void flush_whenWriteFailsWhileConnected_keepsForRetry() {
    registry.register(ID);
    tracker.connected(ID);
    doThrow(new RuntimeException("db down")).when(repository).touch(anyCollection());

    tracker.flush(); // 예외 없음

    reset(repository);
    tracker.flush();
    verify(repository, times(1)).touch(containing(ID));
  }

  @Test
  void connected_whenWriteFails_doesNotThrowAndRetries() {
    registry.register(ID);
    doThrow(new RuntimeException("db down")).when(repository).touch(anyCollection());

    tracker.connected(ID); // 예외 없음

    reset(repository);
    tracker.flush();
    verify(repository, times(1)).touch(containing(ID));
  }

  @Test
  void flush_whenReconnectedDuringWrite_keepsTracking() {
    registry.register(ID);
    tracker.connected(ID);
    registry.closeAll(ID);
    reset(repository);
    // 쓰는 도중 같은 AI 가 다시 붙는다.
    doAnswer(
            inv -> {
              registry.register(ID);
              tracker.connected(ID);
              return null;
            })
        .doNothing()
        .when(repository)
        .touch(anyCollection());

    tracker.flush();
    clearInvocations(repository);

    tracker.flush();
    verify(repository, times(1)).touch(containing(ID));
  }

  @Test
  void flush_whenDisconnectedDuringWrite_stillWritesNextFlush() {
    registry.register(ID);
    tracker.connected(ID);
    reset(repository);
    // 쓰는 도중 연결이 끊긴다 — 이 쓰기는 끊기기 전 상태라 마지막 쓰기가 아니다.
    doAnswer(
            inv -> {
              registry.closeAll(ID);
              return null;
            })
        .doNothing()
        .when(repository)
        .touch(anyCollection());

    tracker.flush();
    clearInvocations(repository);

    tracker.flush(); // 끊긴 뒤의 마지막 쓰기가 남아 있어야 한다
    verify(repository, times(1)).touch(containing(ID));
  }

  @Test
  void flush_whenReconnectedBetweenRecheckAndRemove_keepsTracking() {
    registry.register(ID);
    tracker.connected(ID);
    registry.closeAll(ID);
    reset(repository);
    // 첫 isConnected(쓰기 전 거르기)는 실제 값. 두 번째(빼고 난 뒤 다시 확인)는 실제 값을 돌려주되
    // 그 직후 다시 붙는다 — 확인과 제거 사이에 붙는 경우.
    AtomicInteger calls = new AtomicInteger();
    doAnswer(
            inv -> {
              boolean real = (boolean) inv.callRealMethod();
              if (calls.incrementAndGet() == 2) {
                registry.register(ID);
                tracker.connected(ID);
              }
              return real;
            })
        .when(registry)
        .isConnected(ID);

    tracker.flush();
    clearInvocations(repository);

    tracker.flush();
    verify(repository, times(1)).touch(containing(ID));
  }

  @Test
  void start_runsFlushOnOwnDaemonTimerThread() {
    registry.register(ID);
    tracker.connected(ID);
    reset(repository);
    AtomicReference<Thread> ran = new AtomicReference<>();
    doAnswer(
            inv -> {
              ran.compareAndSet(null, Thread.currentThread()); // 종료 때 테스트 스레드의 마지막 쓰기는 덮지 않는다
              return null;
            })
        .when(repository)
        .touch(anyCollection());

    tracker.start(20);
    try {
      verify(repository, timeout(3000).atLeast(2)).touch(containing(ID));
    } finally {
      tracker.shutdown();
    }
    // 공용 스케줄러 풀이 아니라 이 기록기만의 이름 있는 데몬 스레드에서 돈다.
    assertThat(ran.get().getName()).isEqualTo(AgentConnectionTracker.TIMER_THREAD_NAME);
    assertThat(ran.get().isDaemon()).isTrue();
  }

  @ParameterizedTest
  @ValueSource(classes = {IllegalStateException.class, StackOverflowError.class})
  void start_survivesThrownFailureAndRunsAgain(Class<? extends Throwable> failure) {
    registry.register(ID);
    tracker.connected(ID);
    reset(repository);
    // 첫 회차는 flush 밖으로 새고 그다음은 정상이다 — RuntimeException 뿐 아니라 Error 에도 타이머가 멈추면 안 된다.
    doThrow(failure).doCallRealMethod().when(registry).isConnected(ID);

    tracker.start(20);
    try {
      verify(repository, timeout(3000).atLeastOnce()).touch(containing(ID));
    } finally {
      tracker.shutdown();
    }
  }

  @Test
  void shutdown_writesHeldIdsOnce() {
    registry.register(ID);
    tracker.connected(ID);
    reset(repository);

    tracker.start(60_000); // 첫 회차가 오기 전에 닫는다
    tracker.shutdown();

    verify(repository, times(1)).touch(containing(ID));
  }

  @Test
  void shutdown_withoutStart_stillWritesHeldIds() {
    registry.register(ID);
    tracker.connected(ID);
    reset(repository);

    tracker.shutdown();

    verify(repository, times(1)).touch(containing(ID));
  }

  @Test
  void flush_whenNothingTracked_doesNotTouchDb() {
    registry.register(1L); // 사람 — connected 를 부르지 않는다
    tracker.flush();
    verifyNoInteractions(repository);
  }
}
