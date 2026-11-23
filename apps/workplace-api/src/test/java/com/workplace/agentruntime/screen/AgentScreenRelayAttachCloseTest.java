package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-2013 작업 화면 닫기와 소켓 붙이기의 경합 — close 가 attach 와 같은 잠금 아래에서 closed 표시·표 제거를 하므로, 잠금을 놓은 뒤에는 붙은 소켓은
 * close 가 읽어 닫고 늦은 attach 는 스스로 닫는지 본다. 실제 소켓·DB 없이 mock 으로 검증하고, 닫힘은 원본 소켓의 close 호출로 판정한다.
 */
class AgentScreenRelayAttachCloseTest {

  private static final long TENANT = 1L;

  private AgentScreenRelay relay;
  private AgentScreenRelay.Pair pair;
  private UUID id;

  @BeforeEach
  void setUp() {
    relay =
        new AgentScreenRelay(
            mock(RunnerSseRegistry.class),
            new InMemoryAgentScreenRoutes(),
            new AgentScreenPod("127.0.0.1", 6060),
            new ObjectMapper());
    relay.setService(mock(AgentScreenService.class));
    relay.stopTimerForTest();
    id = UUID.randomUUID();
    relay.reserve(id, TENANT, 2L, 3L, 4L, Instant.now().plusSeconds(600), null);
    pair = relay.pairOf(id);
  }

  @AfterEach
  void tearDown() {
    relay.shutdown();
  }

  private static WebSocketSession socket() {
    WebSocketSession s = mock(WebSocketSession.class);
    when(s.isOpen()).thenReturn(true);
    return s;
  }

  /** 스레드가 잠금을 기다리며 BLOCKED 가 될 때까지(최대 5초) 기다린다. */
  private static void awaitBlocked(Thread t) throws InterruptedException {
    long end = System.currentTimeMillis() + 5000;
    while (t.getState() != Thread.State.BLOCKED && System.currentTimeMillis() < end) {
      Thread.sleep(10);
    }
    assertThat(t.getState()).isEqualTo(Thread.State.BLOCKED);
  }

  /** 스레드가 끝날 때까지(최대 5초) 기다리고, 끝났는지 단언한다 — 잠금이 풀리지 않아 멈춘 경우를 실패로 잡는다. */
  private static void joinDone(Thread t) throws InterruptedException {
    t.join(5000);
    assertThat(t.isAlive()).isFalse();
  }

  @Test
  void close_whileRelayLockHeld_waitsForLock() throws Exception {
    Thread t = new Thread(() -> relay.close(pair, "t", false));
    synchronized (relay) {
      t.start();
      awaitBlocked(t);
      assertThat(pair.closed.get()).isFalse();
      assertThat(relay.pairOf(id)).isNotNull();
    }
    joinDone(t);
    assertThat(pair.closed.get()).isTrue();
    assertThat(relay.pairOf(id)).isNull();
  }

  @Test
  void attachBrowser_afterClose_closesNewSocketWithPolicyViolation() throws Exception {
    relay.close(pair, "t", false);
    WebSocketSession sock = socket();
    relay.attachBrowser(id, sock, false);
    ArgumentCaptor<CloseStatus> cap = ArgumentCaptor.forClass(CloseStatus.class);
    verify(sock, timeout(5000)).close(cap.capture());
    assertThat(cap.getValue().getCode()).isEqualTo(CloseStatus.POLICY_VIOLATION.getCode());
  }

  @Test
  void close_afterAttachBrowser_closesAttachedSocket() throws Exception {
    WebSocketSession sock = socket();
    relay.attachBrowser(id, sock, false);
    relay.close(pair, "t", false);
    ArgumentCaptor<CloseStatus> cap = ArgumentCaptor.forClass(CloseStatus.class);
    verify(sock, timeout(5000)).close(cap.capture());
    assertThat(cap.getValue().getCode()).isEqualTo(CloseStatus.NORMAL.getCode());
  }

  @Test
  void attachBoth_racingClose_allSocketsEndClosed() throws Exception {
    WebSocketSession browser = socket();
    WebSocketSession runner = socket();
    Thread tb = new Thread(() -> relay.attachBrowser(id, browser, false));
    Thread tr = new Thread(() -> relay.attachRunner(id, runner, false));
    Thread tc = new Thread(() -> relay.close(pair, "t", false));
    synchronized (relay) {
      tb.start();
      tr.start();
      tc.start();
      awaitBlocked(tb);
      awaitBlocked(tr);
      awaitBlocked(tc);
    }
    joinDone(tb);
    joinDone(tr);
    joinDone(tc);
    verify(browser, timeout(5000)).close(any(CloseStatus.class));
    verify(runner, timeout(5000)).close(any(CloseStatus.class));
  }
}
