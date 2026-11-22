package com.workplace.agentruntime.screen;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * 화면 중계 타이머 단위 테스트(WP-2009).
 *
 * <p>ScheduledExecutorService 는 작업이 어떤 Throwable 이든 던지면 다음 주기를 취소한다. tick 이 RuntimeException 만 잡으면
 * Error 한 번에 만료·핑·입력 기록이 서버 재시작 전까지 멈추므로, Error 가 나도 다음 주기가 도는지와 한 세션·한 단계의 실패가 나머지를 막지 않는지 확인한다.
 * 실제 타이머를 보는 첫 테스트 말고는 tick 을 직접 부르고, 백그라운드 타이머가 목 호출 수에 끼지 않게 타이머를 멈춰 둔다.
 */
class AgentScreenRelayTimerTest {

  @Test
  void tick_이_Error_로_끝나도_다음_주기가_돈다() {
    RunnerSseRegistry registry = mock(RunnerSseRegistry.class);
    AgentScreenTickets tickets = mock(AgentScreenTickets.class);
    // 첫 호출은 Error, 이후는 정상 — 타이머가 살아 있으면 2번 이상 불린다.
    doThrow(new StackOverflowError("테스트")).doNothing().when(tickets).removeExpired(any());
    AgentScreenRelay relay = new AgentScreenRelay(registry, tickets, new ObjectMapper());
    try {
      verify(tickets, timeout(5_000).atLeast(2)).removeExpired(any());
    } finally {
      relay.shutdown();
    }
  }

  @Test
  void tick_은_한_세션이_실패해도_다른_세션을_계속_처리한다() {
    AgentScreenRelay relay = newRelayWithoutTimer(mock(AgentScreenTickets.class));
    relay.setService(mock(AgentScreenService.class));
    try {
      Instant past = Instant.now().minusSeconds(60);
      UUID a = UUID.randomUUID();
      UUID b = UUID.randomUUID();
      relay.reserve(a, 1L, 10L, 100L, 1L, past);
      relay.reserve(b, 1L, 10L, 100L, 1L, past);
      // 먼저 처리되는 세션의 닫기에서만 Error — close 안의 단계 격리와 무관하게 tick 의 세션별 catch 만 본다.
      AgentScreenRelay failing = spy(relay);
      doThrow(new StackOverflowError("테스트"))
          .doCallRealMethod()
          .when(failing)
          .close(any(), any(), anyBoolean());

      failing.tick();

      verify(failing, times(2)).close(any(), any(), anyBoolean());
      // 첫 닫기만 실패했으므로 정확히 한 세션만 닫혔다(실제 close 가 돌았는지까지 본다).
      long closed = Stream.of(a, b).filter(id -> !relay.canAttachBrowser(id, 1L)).count();
      assertEquals(1, closed);
    } finally {
      relay.shutdown();
    }
  }

  @Test
  void tick_은_입력_기록이_매번_Error_여도_기한이_지난_세션을_닫는다() {
    AgentScreenService service = mock(AgentScreenService.class);
    doThrow(new StackOverflowError("테스트")).when(service).recordInput(anyLong(), any(), anyList());
    AgentScreenRelay relay = newRelayWithoutTimer(mock(AgentScreenTickets.class));
    relay.setService(service);
    try {
      UUID id = UUID.randomUUID();
      relay.reserve(id, 1L, 10L, 100L, 1L, Instant.now().minusSeconds(60));
      pairsOf(relay).get(id).recorder.append(new byte[] {'a'});

      relay.tick();

      verify(service, times(1)).recordClosed(eq(1L), eq(id), any());
      assertFalse(relay.canAttachBrowser(id, 1L));
    } finally {
      relay.shutdown();
    }
  }

  @Test
  void tick_은_한_세션의_핑이_Error_여도_다른_세션에_핑을_보낸다() throws Exception {
    AgentScreenRelay relay = newRelayWithoutTimer(mock(AgentScreenTickets.class));
    relay.setService(mock(AgentScreenService.class));
    // 두 세션이 같은 소켓 목을 쓴다 — 순회 순서와 무관하게 첫 핑만 Error, 둘째 핑은 정상.
    WebSocketSession socket = openSocket();
    doThrow(new StackOverflowError("테스트"))
        .doNothing()
        .when(socket)
        .sendMessage(any(PingMessage.class));
    try {
      Instant future = Instant.now().plusSeconds(60);
      UUID a = UUID.randomUUID();
      UUID b = UUID.randomUUID();
      relay.reserve(a, 1L, 10L, 100L, 1L, future);
      relay.reserve(b, 1L, 10L, 100L, 1L, future);
      pairsOf(relay).get(a).browser = socket;
      pairsOf(relay).get(b).browser = socket;
      ReflectionTestUtils.setField(relay, "lastPing", Instant.EPOCH);

      relay.tick();

      verify(socket, times(2)).sendMessage(any(PingMessage.class));
    } finally {
      relay.shutdown();
    }
  }

  @Test
  void ping_은_브라우저_핑이_Error_여도_runner_에_핑을_보낸다() throws Exception {
    AgentScreenRelay relay = newRelayWithoutTimer(mock(AgentScreenTickets.class));
    relay.setService(mock(AgentScreenService.class));
    WebSocketSession browser = openSocket();
    WebSocketSession runner = openSocket();
    doThrow(new StackOverflowError("테스트")).when(browser).sendMessage(any(PingMessage.class));
    try {
      UUID id = UUID.randomUUID();
      relay.reserve(id, 1L, 10L, 100L, 1L, Instant.now().plusSeconds(60));
      pairsOf(relay).get(id).browser = browser;
      pairsOf(relay).get(id).runner = runner;
      ReflectionTestUtils.setField(relay, "lastPing", Instant.EPOCH);

      relay.tick();

      verify(runner, times(1)).sendMessage(any(PingMessage.class));
    } finally {
      relay.shutdown();
    }
  }

  @Test
  void tick_은_핑_단계가_Error_로_끝나도_밖으로_던지지_않는다() {
    AgentScreenRelay relay = newRelayWithoutTimer(mock(AgentScreenTickets.class));
    relay.setService(mock(AgentScreenService.class));
    try {
      relay.reserve(UUID.randomUUID(), 1L, 10L, 100L, 1L, Instant.now().plusSeconds(60));
      ReflectionTestUtils.setField(relay, "lastPing", Instant.EPOCH);
      // ping 이 소켓별 catch 밖에서 던지는 경우(예: catch 안 로그가 다시 던짐)를 흉내 낸다 — 바깥 catch 가 없으면 tick 밖으로 새어
      // executor 가 주기 작업을 취소한다.
      AgentScreenRelay failing = spy(relay);
      doThrow(new StackOverflowError("테스트")).when(failing).ping(any());

      assertDoesNotThrow(failing::tick);
      verify(failing, times(1)).ping(any());
    } finally {
      relay.shutdown();
    }
  }

  /** 열린 상태로 보이는 소켓 목. */
  private static WebSocketSession openSocket() {
    WebSocketSession s = mock(WebSocketSession.class);
    when(s.isOpen()).thenReturn(true);
    return s;
  }

  /** 백그라운드 타이머를 멈춘 relay — tick 을 테스트가 직접 부른다. */
  private static AgentScreenRelay newRelayWithoutTimer(AgentScreenTickets tickets) {
    AgentScreenRelay relay =
        new AgentScreenRelay(mock(RunnerSseRegistry.class), tickets, new ObjectMapper());
    ((ScheduledExecutorService) ReflectionTestUtils.getField(relay, "timer")).shutdownNow();
    return relay;
  }

  /** relay 의 세션 표를 꺼낸다(소켓·입력을 직접 넣기 위해). */
  @SuppressWarnings("unchecked")
  private static Map<UUID, AgentScreenRelay.Pair> pairsOf(AgentScreenRelay relay) {
    return (Map<UUID, AgentScreenRelay.Pair>) ReflectionTestUtils.getField(relay, "pairs");
  }
}
