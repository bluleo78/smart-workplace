package com.workplace.agentruntime.screen;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

/**
 * 화면 중계 타이머 단위 테스트(WP-2009).
 *
 * <p>ScheduledExecutorService 는 작업이 어떤 Throwable 이든 던지면 다음 주기를 취소한다. tick 이 RuntimeException 만 잡으면
 * Error 한 번에 만료·핑·입력 기록이 서버 재시작 전까지 멈추므로, Error 가 나도 다음 주기가 도는지 확인한다.
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
    RunnerSseRegistry registry = mock(RunnerSseRegistry.class);
    AgentScreenTickets tickets = mock(AgentScreenTickets.class);
    AgentScreenService service = mock(AgentScreenService.class);
    // 먼저 처리되는 세션의 닫기에서만 Error — 순회 순서와 무관하게 한 세션만 실패시킨다.
    doThrow(new StackOverflowError("테스트")).doNothing().when(tickets).removeForSession(any());
    AgentScreenRelay relay = new AgentScreenRelay(registry, tickets, new ObjectMapper());
    relay.setService(service);
    try {
      UUID a = UUID.randomUUID();
      UUID b = UUID.randomUUID();
      Instant past = Instant.now().minusSeconds(60);
      relay.reserve(a, 1L, 10L, 100L, 1L, past);
      relay.reserve(b, 1L, 10L, 100L, 1L, past);

      relay.tick();

      // 하나가 실패해도 나머지는 만료돼 닫혀야 한다(두 세션 모두 더는 붙을 수 없다).
      verify(tickets, times(2)).removeForSession(any());
      assertFalse(relay.canAttachBrowser(a, 1L));
      assertFalse(relay.canAttachBrowser(b, 1L));
    } finally {
      relay.shutdown();
    }
  }
}
