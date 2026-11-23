package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * 주인 파드 쪽 파드 사이 다리 퐁 제한 단위 테스트(WP-1978) — 다른 파드가 내부 경로로 넘겨 온 소켓의 퐁이 60초 없으면 tick 이 화면을 닫고, 퐁이 오면
 * 시각이 늘고, 직접 붙은 소켓은 퐁 제한을 보지 않는다. 백그라운드 타이머를 멈추고 tick 을 직접 부른다.
 */
class AgentScreenRelayPodLinkTest {

  private AgentScreenRelay relay;
  private AgentScreenService service;
  private final UUID id = UUID.randomUUID();

  @BeforeEach
  void setUp() {
    relay =
        new AgentScreenRelay(
            mock(RunnerSseRegistry.class),
            new InMemoryAgentScreenRoutes(),
            new AgentScreenPod("127.0.0.1", 6060),
            new ObjectMapper());
    ((ScheduledExecutorService) ReflectionTestUtils.getField(relay, "timer")).shutdownNow();
    service = mock(AgentScreenService.class);
    relay.setService(service);
    relay.reserve(id, 1L, 10L, 100L, 1L, Instant.now().plusSeconds(60), null);
  }

  @AfterEach
  void tearDown() {
    relay.shutdown();
  }

  /** 열린 상태로 보이는 소켓 목 — 세션 비교에 쓰는 id 를 준다. */
  private static WebSocketSession socket(String socketId) {
    WebSocketSession s = mock(WebSocketSession.class);
    when(s.isOpen()).thenReturn(true);
    when(s.getId()).thenReturn(socketId);
    return s;
  }

  /** 퐁 시각을 제한보다 오래 전으로 돌린다. */
  private static Instant stale() {
    return Instant.now().minus(AgentScreenRelay.PONG_TIMEOUT).minusSeconds(1);
  }

  /** 그 소켓에 퐁 뒤 핑을 보냈고 답을 기다려 주는 시간도 지난 상태로 둔다 — 보낸 핑에도 답이 없음. */
  private void pingedButUnanswered() {
    AgentScreenRelay.Pair p = relay.pairOf(id);
    Instant pingAt = Instant.now().minus(AgentScreenRelay.PONG_ANSWER_WAIT).minusSeconds(1);
    p.browserPingAt = pingAt;
    p.runnerPingAt = pingAt;
  }

  @Test
  void 넘겨_온_브라우저의_퐁이_60초_없으면_tick_이_화면을_닫는다() {
    relay.attachBrowser(id, socket("b"), true);
    relay.attachRunner(id, socket("r"), false);
    relay.pairOf(id).browserPong = stale();
    pingedButUnanswered();

    relay.tick();

    verify(service).recordClosed(eq(1L), eq(id), eq(AgentScreenRelay.REASON_POD_LINK_LOST));
    assertThat(relay.pairOf(id)).isNull();
  }

  @Test
  void 넘겨_온_runner_의_퐁이_60초_없으면_tick_이_화면을_닫는다() {
    relay.attachBrowser(id, socket("b"), false);
    relay.attachRunner(id, socket("r"), true);
    relay.pairOf(id).runnerPong = stale();
    pingedButUnanswered();

    relay.tick();

    verify(service).recordClosed(eq(1L), eq(id), eq(AgentScreenRelay.REASON_POD_LINK_LOST));
  }

  @Test
  void 퐁이_오면_시각이_늘어_닫지_않는다() {
    WebSocketSession browser = socket("b");
    relay.attachBrowser(id, browser, true);
    relay.attachRunner(id, socket("r"), false);
    relay.pairOf(id).browserPong = stale();

    relay.pong(id, browser);
    relay.tick();

    verify(service, never()).recordClosed(any(Long.class), any(), any());
    assertThat(relay.pairOf(id)).isNotNull();
  }

  @Test
  void 다른_소켓의_퐁은_시각을_늘리지_않는다() {
    relay.attachBrowser(id, socket("b"), true);
    relay.attachRunner(id, socket("r"), false);
    relay.pairOf(id).browserPong = stale();
    pingedButUnanswered();

    relay.pong(id, socket("other"));
    relay.tick();

    verify(service).recordClosed(eq(1L), eq(id), eq(AgentScreenRelay.REASON_POD_LINK_LOST));
  }

  /**
   * 타이머 스레드가 DB 호출로 묶여 핑을 못 보낸 동안(마지막 핑이 마지막 퐁보다 앞섬)은 퐁이 60초 없어도 끊김으로 치지 않는다(WP-1978 리뷰 후속 ①) — 보낸
   * 핑이 없으니 답이 없는 것이 당연하다. 풀린 뒤 보낸 핑에 답을 기다려 주는 동안에도 닫지 않는다.
   */
  @Test
  void 타이머가_묶여_핑을_못_보냈으면_퐁이_60초_없어도_닫지_않는다() {
    relay.attachBrowser(id, socket("b"), true);
    relay.attachRunner(id, socket("r"), false);
    Instant pong = stale();
    relay.pairOf(id).browserPong = pong;
    // 마지막으로 이 소켓에 핑을 보낸 때가 마지막 퐁보다 앞선다 — 그 뒤로 타이머가 묶여 핑을 못 보냄.
    relay.pairOf(id).browserPingAt = pong.minusSeconds(1);
    ReflectionTestUtils.setField(relay, "lastPing", Instant.EPOCH); // 풀린 첫 tick 이 핑을 보내게

    relay.tick(); // 묶였던 타이머가 풀린 첫 tick — 만료 검사 뒤 핑을 보낸다
    relay.tick(); // 방금 보낸 핑의 답을 기다려 주는 중

    verify(service, never()).recordClosed(any(Long.class), any(), any());
    assertThat(relay.pairOf(id)).isNotNull();
    // 풀린 tick 이 이 소켓에 실제로 핑을 보낸 시각을 적었다.
    assertThat(relay.pairOf(id).browserPingAt).isAfter(pong);
  }

  /** 퐁 뒤에 핑을 보냈더라도 답을 기다려 주는 시간 안이면 닫지 않는다. */
  @Test
  void 보낸_핑의_답을_기다리는_동안은_닫지_않는다() {
    relay.attachBrowser(id, socket("b"), true);
    relay.attachRunner(id, socket("r"), false);
    relay.pairOf(id).browserPong = stale();
    relay.pairOf(id).browserPingAt = Instant.now().minusSeconds(1);

    relay.tick();

    verify(service, never()).recordClosed(any(Long.class), any(), any());
  }

  @Test
  void 직접_붙은_소켓은_퐁_제한을_보지_않는다() {
    WebSocketSession browser = socket("b");
    relay.attachBrowser(id, browser, false);
    relay.attachRunner(id, socket("r"), false);
    // 직접 붙은 소켓은 퐁 시각이 없고, 퐁이 와도 생기지 않는다 — 그래서 아무리 오래 지나도 퐁 제한으로 닫지 않는다.
    relay.pong(id, browser);
    assertThat(relay.pairOf(id).browserPong).isNull();
    assertThat(relay.pairOf(id).runnerPong).isNull();

    relay.tick();

    verify(service, never()).recordClosed(any(Long.class), any(), any());
  }

  @Test
  void 넘기던_파드가_멈춰_닫히면_서버_멈춤_까닭을_남긴다() {
    WebSocketSession browser = socket("b");
    relay.attachBrowser(id, browser, true);

    relay.browserClosed(id, browser, AgentScreenRelay.REASON_SHUTDOWN);

    verify(service).recordClosed(eq(1L), eq(id), eq(AgentScreenRelay.REASON_SHUTDOWN));
  }
}
