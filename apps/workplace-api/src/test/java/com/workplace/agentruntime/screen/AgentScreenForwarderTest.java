package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.PongMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

/**
 * 넘기기 관 단위 테스트(WP-1978 리뷰 후속) — 위쪽 다리 핑과 퐁 제한(60초), 늦게 열린 위쪽 다리 닫기, 파드 멈춤 때의 닫기 상태를 가짜 소켓과 직접 부르는
 * {@code pingAll(now)} 로 본다(실제 주인 파드·25초 주기 없이).
 */
class AgentScreenForwarderTest {

  private AgentScreenForwarder forwarder;
  private WebSocketSession inbound;
  private WebSocketSession upstream;

  @BeforeEach
  void setUp() {
    forwarder = new AgentScreenForwarder("token");
    forwarder.stopPingerForTest();
    inbound = socket("in");
    upstream = socket("up");
  }

  @AfterEach
  void tearDown() {
    forwarder.shutdown();
  }

  /** 열린 상태로 보이는 소켓 목. */
  private static WebSocketSession socket(String socketId) {
    WebSocketSession s = mock(WebSocketSession.class);
    when(s.isOpen()).thenReturn(true);
    when(s.getId()).thenReturn(socketId);
    return s;
  }

  /** 소켓이 닫힌 상태를 꺼낸다. */
  private static CloseStatus closedWith(WebSocketSession s) throws Exception {
    ArgumentCaptor<CloseStatus> status = ArgumentCaptor.forClass(CloseStatus.class);
    verify(s).close(status.capture());
    return status.getValue();
  }

  /** 관을 만들고 위쪽 다리를 연 뒤 첫 퐁(등록 확인)까지 받은 상태. */
  private AbstractWebSocketHandler linked() throws Exception {
    AbstractWebSocketHandler handler = forwarder.linkForTest(inbound, "s1");
    handler.afterConnectionEstablished(upstream);
    handler.handleMessage(upstream, new PongMessage());
    return handler;
  }

  @Test
  void pingAll_은_받은_다리와_위쪽_다리_모두에_핑을_보낸다() throws Exception {
    linked();

    forwarder.pingAll(System.nanoTime());

    verify(inbound).sendMessage(any(PingMessage.class));
    verify(upstream).sendMessage(any(PingMessage.class));
    verify(upstream, never()).close(any());
  }

  @Test
  void 위쪽_다리의_퐁이_60초_없으면_두_다리를_닫는다() throws Exception {
    linked();
    long later =
        System.nanoTime() + AgentScreenRelay.PONG_TIMEOUT.toNanos() + TimeUnit.SECONDS.toNanos(1);

    forwarder.pingAll(later);

    assertThat(closedWith(upstream).getCode()).isEqualTo(CloseStatus.SERVER_ERROR.getCode());
    assertThat(closedWith(inbound).getCode()).isEqualTo(CloseStatus.SERVER_ERROR.getCode());
  }

  @Test
  void 퐁이_오면_제한이_다시_시작된다() throws Exception {
    AbstractWebSocketHandler handler = linked();
    // 퐁 시각은 실제 시계로 적힌다 — 방금 받은 퐁 뒤 제한의 절반이 지난 시점에는 닫지 않는다.
    handler.handleMessage(upstream, new PongMessage());

    forwarder.pingAll(System.nanoTime() + AgentScreenRelay.PONG_TIMEOUT.toNanos() / 2);

    verify(upstream, never()).close(any());
    verify(inbound, never()).close(any());
  }

  @Test
  void 닫힌_뒤에_늦게_열린_위쪽_다리는_바로_닫는다() throws Exception {
    AbstractWebSocketHandler handler = forwarder.linkForTest(inbound, "s1");
    // 받은 소켓이 먼저 닫혀(또는 잇기 제한 시간이 지나) 관이 닫힌 뒤에야 위쪽 다리가 열린다.
    forwarder.inboundClosed(inbound, CloseStatus.NORMAL);

    handler.afterConnectionEstablished(upstream);

    assertThat(closedWith(upstream).getCode()).isEqualTo(CloseStatus.GOING_AWAY.getCode());
  }

  @Test
  void 열린_위쪽_다리는_관에_적혀_관을_닫을_때_함께_닫힌다() throws Exception {
    AbstractWebSocketHandler handler = forwarder.linkForTest(inbound, "s1");
    // 퐁(등록 확인) 전 — open() 이 제한 시간을 넘겨 포기하는 경우와 같다. 관을 닫으면 위쪽 다리도 닫힌다.
    handler.afterConnectionEstablished(upstream);

    forwarder.inboundClosed(inbound, CloseStatus.NORMAL);

    assertThat(closedWith(upstream).getCode()).isEqualTo(CloseStatus.NORMAL.getCode());
  }

  /**
   * 주인 파드가 위쪽 다리를 닫을 때 받은 다리로 넘기던 마지막 프레임(끝남 상태)이 아직 나가는 중이면, 다 나간 뒤에 받은 다리를 닫는다(WP-1978 리뷰 후속 ② —
   * 바로 닫으면 그 프레임이 버려진다, WP-2015 와 같은 결함).
   */
  @Test
  void 위쪽_다리가_닫히면_받은_다리로_나가던_프레임을_보낸_뒤에_닫는다() throws Exception {
    AbstractWebSocketHandler handler = linked();
    CountDownLatch sending = new CountDownLatch(1);
    AtomicLong sentAt = new AtomicLong();
    AtomicLong closedAt = new AtomicLong();
    CountDownLatch closed = new CountDownLatch(1);
    doAnswer(
            inv -> {
              if (inv.getArgument(0) instanceof TextMessage) {
                sending.countDown();
                Thread.sleep(300); // 느린 브라우저 쪽 보내기
                sentAt.set(System.nanoTime());
              }
              return null;
            })
        .when(inbound)
        .sendMessage(any());
    doAnswer(
            inv -> {
              closedAt.set(System.nanoTime());
              closed.countDown();
              return null;
            })
        .when(inbound)
        .close(any());
    Thread sender =
        new Thread(
            () -> {
              try {
                handler.handleMessage(upstream, new TextMessage("{\"type\":\"status\"}"));
              } catch (Exception e) {
                throw new IllegalStateException(e);
              }
            });
    sender.start();
    assertThat(sending.await(2, TimeUnit.SECONDS)).isTrue();

    long beforeClose = System.nanoTime();
    handler.afterConnectionClosed(upstream, CloseStatus.NORMAL);
    // 드레인 대기는 별도 스레드에서 한다 — 닫힘을 알린 스레드는 바로 돌아온다(공유 I/O 스레드를 붙잡지 않게).
    assertThat(System.nanoTime() - beforeClose).isLessThan(TimeUnit.MILLISECONDS.toNanos(150));
    assertThat(closed.await(3, TimeUnit.SECONDS)).isTrue();
    sender.join(2_000);

    assertThat(closedAt.get()).isPositive();
    assertThat(closedAt.get()).isGreaterThanOrEqualTo(sentAt.get());
    assertThat(sentAt.get()).isPositive();
  }

  @Test
  void 파드가_멈추면_위쪽_다리는_파드_멈춤_상태로_받은_다리는_1001_로_닫는다() throws Exception {
    linked();

    forwarder.shutdown();

    assertThat(closedWith(upstream).getCode())
        .isEqualTo(AgentScreenForwarder.POD_SHUTDOWN.getCode());
    assertThat(closedWith(inbound).getCode()).isEqualTo(CloseStatus.GOING_AWAY.getCode());
  }
}
