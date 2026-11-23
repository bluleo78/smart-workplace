package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.io.IOException;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * {@link AgentScreenRelay#close} 의 단계 격리 — 한 단계가 예외·Error 로 실패해도 나머지 단계가 모두 실행되고, 두 번째 close 는 아무것도
 * 다시 하지 않는지 본다. 실패 주입이 필요해 DB 없이 Mockito 로 협력자를 대체한다.
 */
@ExtendWith(OutputCaptureExtension.class)
class AgentScreenRelayCloseTest {

  private static final String REASON = "테스트 까닭";

  private InMemoryAgentScreenRoutes routes;
  private AgentScreenService service;
  private WebSocketSession browser;
  private WebSocketSession runner;
  private AgentScreenRelay relay;

  @BeforeEach
  void setUp() throws InterruptedException {
    routes = spy(new InMemoryAgentScreenRoutes());
    service = mock(AgentScreenService.class);
    browser = mock(WebSocketSession.class);
    runner = mock(WebSocketSession.class);
    when(browser.isOpen()).thenReturn(true);
    when(runner.isOpen()).thenReturn(true);
    relay =
        new AgentScreenRelay(
            mock(RunnerSseRegistry.class),
            routes,
            new AgentScreenPod("127.0.0.1", 6060),
            new ObjectMapper());
    relay.setService(service);
    // 실제 1초 타이머의 tick 이 routes 스파이에 끼어들면 Mockito 스텁이 엉뚱한 메서드에 붙는다 — 공유 relay 의 타이머는 멈춰 둔다
    var timer = timerOf(relay);
    timer.shutdownNow();
    // shutdownNow 는 이미 시작한 tick 을 기다리지 않는다 — 끝난 뒤에야 테스트가 목을 스텁한다
    assertTrue(timer.awaitTermination(5, TimeUnit.SECONDS), "타이머가 5초 안에 끝나야 한다");
  }

  /** relay 내부 타이머를 꺼낸다. */
  private static ScheduledExecutorService timerOf(AgentScreenRelay target) {
    return (ScheduledExecutorService) ReflectionTestUtils.getField(target, "timer");
  }

  @AfterEach
  void tearDown() {
    relay.shutdown();
  }

  /** 입력 1바이트가 쌓인 세션. withSockets 가 true 면 두 소켓을 붙이고, false 면 어느 쪽도 붙이지 않는다. */
  private AgentScreenRelay.Pair pair(boolean withSockets) {
    var p = new AgentScreenRelay.Pair(UUID.randomUUID(), 1L, 10L, 100L, 1L, Instant.MAX);
    if (withSockets) {
      p.browser = browser;
      p.runner = runner;
    }
    p.recorder.append(new byte[] {'a'});
    return p;
  }

  private void verifyClosedRecorded(AgentScreenRelay.Pair p) {
    verify(service, times(1)).recordClosed(1L, p.id, REASON);
  }

  private void verifySocketsClosed() throws IOException {
    verify(browser, times(1)).close(any(CloseStatus.class));
    verify(runner, times(1)).close(any(CloseStatus.class));
  }

  @Test
  void close_whenRouteCleanupThrows_finishesRemainingSteps() throws Exception {
    var p = pair(true);
    doThrow(new IllegalStateException("x")).when(routes).remove(p.id);

    assertThatCode(() -> relay.close(p, REASON, true)).doesNotThrowAnyException();

    verify(service, times(1)).recordInput(eq(1L), eq(p.id), anyList());
    verify(browser, times(1)).sendMessage(any(TextMessage.class));
    verifySocketsClosed();
    verifyClosedRecorded(p);
  }

  @Test
  void close_whenInputRecordThrowsError_finishesRemainingSteps(CapturedOutput output)
      throws Exception {
    var p = pair(true);
    doThrow(new StackOverflowError()).when(service).recordInput(anyLong(), any(), anyList());

    assertThatCode(() -> relay.close(p, REASON, true)).doesNotThrowAnyException();

    verify(browser, times(1)).sendMessage(any(TextMessage.class));
    verifySocketsClosed();
    verifyClosedRecorded(p);
    // 삼킨 Error 의 유일한 흔적인 경고 로그가 실패한 단계 이름과 세션 id 를 담는지 본다
    assertThat(output.getAll()).contains("step=입력 기록", "session=" + p.id);
  }

  @Test
  void close_whenNotifyThrowsError_finishesRemainingSteps() throws Exception {
    var p = pair(true);
    doThrow(new StackOverflowError()).when(browser).sendMessage(any());

    assertThatCode(() -> relay.close(p, REASON, true)).doesNotThrowAnyException();

    verifySocketsClosed();
    verifyClosedRecorded(p);
  }

  @Test
  void close_whenBrowserStateCheckThrows_closesRunnerAndRecords() throws Exception {
    var p = pair(true);
    when(browser.isOpen()).thenThrow(new IllegalStateException("x"));

    assertThatCode(() -> relay.close(p, REASON, true)).doesNotThrowAnyException();

    verify(runner, times(1)).close(any(CloseStatus.class));
    verifyClosedRecorded(p);
  }

  @Test
  void close_whenBrowserCloseThrowsError_closesRunnerAndRecords() throws Exception {
    var p = pair(true);
    doThrow(new StackOverflowError()).when(browser).close(any(CloseStatus.class));

    assertThatCode(() -> relay.close(p, REASON, true)).doesNotThrowAnyException();

    verify(runner, times(1)).close(any(CloseStatus.class));
    verifyClosedRecorded(p);
  }

  @Test
  void close_whenRunnerCloseThrowsError_records() throws Exception {
    var p = pair(true);
    doThrow(new StackOverflowError()).when(runner).close(any(CloseStatus.class));

    assertThatCode(() -> relay.close(p, REASON, true)).doesNotThrowAnyException();

    verify(browser, times(1)).close(any(CloseStatus.class));
    verifyClosedRecorded(p);
  }

  @Test
  void close_whenEveryStepThrows_triesAllAndDoesNotRepeat() throws Exception {
    var p = pair(true);
    doThrow(new StackOverflowError()).when(routes).remove(any());
    doThrow(new StackOverflowError()).when(service).recordInput(anyLong(), any(), anyList());
    doThrow(new StackOverflowError()).when(browser).sendMessage(any());
    doThrow(new StackOverflowError()).when(browser).close(any(CloseStatus.class));
    doThrow(new StackOverflowError()).when(runner).close(any(CloseStatus.class));
    doThrow(new StackOverflowError()).when(service).recordClosed(anyLong(), any(), any());

    assertThatCode(
            () -> {
              relay.close(p, REASON, true);
              relay.close(p, REASON, true);
            })
        .doesNotThrowAnyException();

    verify(routes, times(1)).remove(p.id);
    verify(service, times(1)).recordInput(eq(1L), eq(p.id), anyList());
    verify(browser, times(1)).sendMessage(any(TextMessage.class));
    verify(browser, times(1)).close(any(CloseStatus.class));
    verify(runner, times(1)).close(any(CloseStatus.class));
    verifyClosedRecorded(p);
  }

  @Test
  void close_whenNoSocketAttached_records() {
    var p = pair(false);
    doThrow(new IllegalStateException("x")).when(routes).remove(p.id);

    assertThatCode(() -> relay.close(p, REASON, true)).doesNotThrowAnyException();

    verifyClosedRecorded(p);
  }

  @Test
  void close_whenBrowserClosedIt_doesNotNotify() throws Exception {
    var p = pair(true);
    doThrow(new IllegalStateException("x")).when(routes).remove(p.id);

    assertThatCode(() -> relay.close(p, REASON, false)).doesNotThrowAnyException();

    verify(browser, never()).sendMessage(any());
    verifySocketsClosed();
    verifyClosedRecorded(p);
  }

  @Test
  void shutdown_whenOneSessionFails_closesTheOthers() {
    UUID a = UUID.randomUUID();
    UUID b = UUID.randomUUID();
    relay.reserve(a, 1L, 10L, 100L, 1L, Instant.MAX, null);
    relay.reserve(b, 1L, 10L, 100L, 1L, Instant.MAX, null);
    doThrow(new IllegalStateException("x")).doNothing().when(routes).remove(any());

    assertThatCode(() -> relay.shutdown()).doesNotThrowAnyException();

    ArgumentCaptor<UUID> ids = ArgumentCaptor.forClass(UUID.class);
    verify(service, times(2)).recordClosed(eq(1L), ids.capture(), any());
    assertThat(ids.getAllValues()).containsExactlyInAnyOrder(a, b);
  }

  /** close 자체가 던져도(단계 로그까지 실패) shutdown 은 타이머를 반드시 멈춘다 — 멈추지 않으면 데몬 스레드가 남는다. */
  @Test
  void shutdown_whenCloseItselfThrows_stillStopsTimer() {
    // 공유 relay 는 타이머를 꺼 두었으므로, 타이머가 살아 있는 전용 relay 로 본다
    var own =
        new AgentScreenRelay(
            mock(RunnerSseRegistry.class),
            new InMemoryAgentScreenRoutes(),
            new AgentScreenPod("127.0.0.1", 6060),
            new ObjectMapper());
    var timer = timerOf(own);
    try {
      own.reserve(UUID.randomUUID(), 1L, 10L, 100L, 1L, Instant.MAX, null);
      AgentScreenRelay failing = spy(own);
      doThrow(new StackOverflowError()).when(failing).close(any(), anyString(), anyBoolean());
      assertFalse(timer.isShutdown());

      assertThrows(StackOverflowError.class, failing::shutdown);

      assertTrue(timer.isShutdown());
    } finally {
      // 테스트가 실패해도 데몬 타이머가 남지 않게 한다
      timer.shutdownNow();
    }
  }
}
