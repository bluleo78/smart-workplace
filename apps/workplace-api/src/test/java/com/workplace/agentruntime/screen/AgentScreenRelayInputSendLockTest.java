package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-2013 리뷰 후속 — 입력 다툼 거절(rejectIfTaken·requestInput)이 relay 잠금을 쥔 채 소켓으로 보내면, 느린 소켓 보내기가 같은 잠금을
 * 잡는 close·타이머·붙기를 보내기 상한만큼 붙든다. 잠금 안에서는 판단만 하고 보내기는 잠금을 놓은 뒤에 하는지, 보내기가 멈춰 있는 동안 다른 세션의 close 가
 * 끝나는 것으로 본다. 실제 소켓·DB 없이 mock 으로 보내기를 멈춰 세운다.
 */
class AgentScreenRelayInputSendLockTest {

  private static final long TENANT = 1L;
  private static final long AGENT = 2L;

  private AgentScreenRelay relay;
  private InMemoryAgentScreenRoutes routes;
  private AgentScreenService service;
  private AgentScreenRelay.Pair holder; // 이미 입력을 쥔 화면
  private AgentScreenRelay.Pair other; // 입력을 달라는 같은 AI 의 다른 화면
  private UUID otherId;
  private final CountDownLatch sending = new CountDownLatch(1);
  private final CountDownLatch release = new CountDownLatch(1);

  @BeforeEach
  void setUp() {
    routes = new InMemoryAgentScreenRoutes();
    relay =
        new AgentScreenRelay(
            mock(RunnerSseRegistry.class),
            routes,
            new AgentScreenPod("127.0.0.1", 6060),
            new ObjectMapper());
    service = mock(AgentScreenService.class);
    relay.setService(service);
    relay.stopTimerForTest();
    UUID holderId = UUID.randomUUID();
    otherId = UUID.randomUUID();
    relay.reserve(holderId, TENANT, AGENT, 3L, 4L, Instant.now().plusSeconds(600), null);
    relay.reserve(otherId, TENANT, AGENT, 3L, 4L, Instant.now().plusSeconds(600), null);
    holder = relay.pairOf(holderId);
    other = relay.pairOf(otherId);
  }

  @AfterEach
  void tearDown() {
    release.countDown();
    relay.shutdown();
  }

  /** 이미 입력을 쥔 화면으로 만든다 — 메모리 플래그와 공유 경로 표의 입력 중 표시(판정은 표로 한다, WP-1978). */
  private void holdInput() {
    holder.inputEnabled = true;
    assertThat(routes.claimInput(holder.id, TENANT, AGENT)).isTrue();
  }

  /** 입력 켜기 프레임 — 브라우저 요청·runner 알림 모두 같은 모양이다. */
  private static TextMessage inputOn() {
    return new TextMessage("{\"type\":\"input\",\"enabled\":true}");
  }

  private static WebSocketSession socket() {
    WebSocketSession s = mock(WebSocketSession.class);
    when(s.isOpen()).thenReturn(true);
    when(s.getId()).thenReturn(UUID.randomUUID().toString());
    return s;
  }

  /** 보내기가 들어오면 알리고 풀어 줄 때까지 멈추는 소켓 — 느린 소켓 보내기를 흉내 낸다. */
  private WebSocketSession stuckSocket() throws Exception {
    WebSocketSession s = socket();
    doAnswer(
            inv -> {
              sending.countDown();
              release.await(10, TimeUnit.SECONDS);
              return null;
            })
        .when(s)
        .sendMessage(any());
    return s;
  }

  /** 보내기가 멈춘 동안 다른 세션의 close 가 5초 안에 끝나는지 — 잠금을 쥔 채 보내면 close 가 잠금을 기다려 끝나지 않는다. */
  private void assertCloseNotBlockedWhileSending(Thread sender) throws Exception {
    sender.start();
    assertThat(sending.await(5, TimeUnit.SECONDS)).as("보내기에 들어감").isTrue();
    Thread closer = new Thread(() -> relay.close(holder, "t", false));
    closer.start();
    closer.join(5000);
    boolean closerDone = !closer.isAlive();
    release.countDown();
    sender.join(5000);
    closer.join(5000);
    assertThat(closerDone).as("보내기가 멈춘 동안 close 가 끝남").isTrue();
    assertThat(sender.isAlive()).isFalse();
    assertThat(holder.closed.get()).isTrue();
  }

  @Test
  void requestInput_rejectionSend_doesNotHoldRelayLock() throws Exception {
    holdInput();
    relay.attachBrowser(otherId, stuckSocket(), false);
    relay.attachRunner(otherId, socket(), false);
    Thread sender = new Thread(() -> relay.fromBrowserText(otherId, inputOn()));
    assertCloseNotBlockedWhileSending(sender);
  }

  @Test
  void runnerInput_firstRejectionSend_doesNotHoldRelayLock() throws Exception {
    holdInput();
    relay.attachBrowser(otherId, socket(), false);
    relay.attachRunner(otherId, stuckSocket(), false);
    Thread sender = new Thread(() -> relay.fromRunner(otherId, inputOn()));
    assertCloseNotBlockedWhileSending(sender);
    assertThat(other.inputEnabled).isFalse();
  }

  @Test
  void runnerInput_recheckRejectionSend_doesNotHoldRelayLock() throws Exception {
    // 기록하는 동안 다른 화면이 먼저 입력을 켠 경우 — 기록 뒤 다시 보기에서 거절된다.
    doAnswer(
            inv -> {
              holdInput();
              return null;
            })
        .when(service)
        .recordInputEnabled(TENANT, otherId, AGENT, 4L);
    relay.attachBrowser(otherId, socket(), false);
    relay.attachRunner(otherId, stuckSocket(), false);
    Thread sender = new Thread(() -> relay.fromRunner(otherId, inputOn()));
    assertCloseNotBlockedWhileSending(sender);
    assertThat(other.inputEnabled).isFalse();
  }
}
