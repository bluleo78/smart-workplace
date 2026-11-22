package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-2015 끝남 프레임 재현 단위 테스트(DB·스프링 컨텍스트 없음) — runner 출력이 소켓으로 나가는 중에 세션을 닫아도 브라우저가 ended 상태 프레임을 원래
 * 소켓으로 받은 뒤에 닫힘을 본다.
 *
 * <p>브라우저 목의 첫 보내기를 래치로 멈춰 두어 데코레이터가 프레임을 내보내지 못하게 한 뒤, 그 와중에 닫기가 일어나게 만든다(이슈의 재현 조건).
 *
 * <p>이어서 닫기의 경계를 박는다: 끝내 막히는 소켓에서도 유한 시간에 닫히는가, 브라우저가 하나도 붙지 않은 채로, 이미 닫힌 소켓에서, 대기 중 인터럽트를 받아도 닫힘이
 * 늦어지거나 유실되지 않는가, 그리고 보내는 중이 아닐 때는 대기 없이 바로 닫히는가(WP-2015).
 */
class AgentScreenRelayEndedFrameTest {

  @Test
  void close_whileRunnerOutputIsInFlight_deliversEndedFrameBeforeClosing() throws Exception {
    ObjectMapper om = new ObjectMapper();
    AgentScreenRelay relay =
        new AgentScreenRelay(new RunnerSseRegistry(om), new AgentScreenTickets(), om);
    // 닫힘 기록을 검증할 수 있게 서비스를 넣는다 — 안 넣으면 NPE 경고만 남고 검증도 못 한다.
    AgentScreenService screenService = mock(AgentScreenService.class);
    relay.setService(screenService);

    // 목 소켓에 일어난 일의 순서를 적어 두고 마지막에 단언한다.
    List<String> events = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch sendEntered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicBoolean firstSend = new AtomicBoolean(true);

    WebSocketSession rawBrowser = mock(WebSocketSession.class);
    when(rawBrowser.isOpen()).thenReturn(true);
    when(rawBrowser.getId()).thenReturn("browser-1");
    doAnswer(
            inv -> {
              WebSocketMessage<?> message = inv.getArgument(0);
              events.add(
                  "send:"
                      + (message instanceof TextMessage text
                          ? text.getPayload()
                          : message.getClass().getName()));
              // 첫 보내기만 멈춘다 — runner 출력이 소켓을 점유한 채 끝남 알림이 뒤이어 들어오는 상황을 만든다.
              if (firstSend.compareAndSet(true, false)) {
                sendEntered.countDown();
                release.await(10, TimeUnit.SECONDS);
              }
              return null;
            })
        .when(rawBrowser)
        .sendMessage(any());

    WebSocketSession rawRunner = mock(WebSocketSession.class);
    when(rawRunner.isOpen()).thenReturn(true);
    when(rawRunner.getId()).thenReturn("runner-1");
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawBrowser)
        .close(any(CloseStatus.class));
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawRunner)
        .close(any(CloseStatus.class));

    UUID id = UUID.randomUUID();
    relay.reserve(id, 1L, 10L, 20L, 30L, Instant.now().plusSeconds(30));
    relay.attachBrowser(id, rawBrowser);
    relay.attachRunner(id, rawRunner);

    Thread runnerOutput = new Thread(() -> relay.fromRunner(id, new BinaryMessage(new byte[64])));
    runnerOutput.start();
    assertThat(sendEntered.await(10, TimeUnit.SECONDS)).as("브라우저 목의 첫 보내기에서 멈춰야 한다").isTrue();

    // 닫기는 끝남 알림을 데코레이터 버퍼에 넣은 뒤 유한 드레인 대기(2초)에 들어간다 — 막힌 보내기가 안 풀리니 대기는 끝까지 이어진다(WP-2015).
    Thread closer = new Thread(() -> relay.runnerClosed(id, rawRunner));
    closer.start();
    // 래치는 "close" 가 기록되면(= 닫기가 끝나면) 곧바로, 아니면 1_000ms 지난 뒤에 풀린다 —
    // 첫 보내기가 드레인 상한(ENDED_DRAIN_TIMEOUT_MS 2_000ms) 안에서 풀리지 않아 대기가 끝까지 이어지는 판이라
    // 실제로는 1_000ms 고정 대기 후 풀린다. 남은 1_000ms 는 프레임이 나가고 대기 루프가 이를 알아채는 여유(WP-2015).
    long releaseDeadline = System.currentTimeMillis() + 1_000;
    while (!events.contains("close") && System.currentTimeMillis() < releaseDeadline) {
      Thread.sleep(10);
    }
    release.countDown();
    // 기다리는 모든 join 은 시간 제한 — 무한 join 은 회귀가 걸렸을 때 스위트를 죽인다.
    closer.join(10_000);
    runnerOutput.join(10_000);

    assertThat(events)
        .anyMatch(e -> e.startsWith("send:") && e.contains("\"state\":\"ended\""))
        .contains("close");
    assertThat(endedFrameIndex(events))
        .as("끝남 프레임이 닫힘 기록보다 앞선다")
        .isLessThan(events.indexOf("close"));
    verify(screenService).recordClosed(eq(1L), eq(id), anyString());
  }

  /**
   * 경계 — 브라우저 목의 첫 보내기가 끝내 풀리지 않아도 닫기가 유한 시간(ENDED_DRAIN_TIMEOUT_MS + 5_000 ms) 안에 끝나야 한다. 드레인이 무한히
   * 래치를 기다리면 이 단언이 죽는다. 래치는 시험 내내 세워 두고 finally 에서만 풀어 대기 조건이 닫히는 순간까지 유지된다.
   */
  @Test
  void close_whenBrowserSendNeverFinishes_stillClosesAfterTimeout() throws Exception {
    ObjectMapper om = new ObjectMapper();
    AgentScreenRelay relay =
        new AgentScreenRelay(new RunnerSseRegistry(om), new AgentScreenTickets(), om);
    // 닫힘 기록을 검증할 수 있게 서비스를 넣는다 — 안 넣으면 NPE 경고만 남고 검증도 못 한다.
    AgentScreenService screenService = mock(AgentScreenService.class);
    relay.setService(screenService);

    // 목 소켓에 일어난 일의 순서를 적어 두고 마지막에 단언한다.
    List<String> events = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch sendEntered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicBoolean firstSend = new AtomicBoolean(true);

    WebSocketSession rawBrowser = mock(WebSocketSession.class);
    when(rawBrowser.isOpen()).thenReturn(true);
    when(rawBrowser.getId()).thenReturn("browser-1");
    doAnswer(
            inv -> {
              WebSocketMessage<?> message = inv.getArgument(0);
              events.add(
                  "send:"
                      + (message instanceof TextMessage text
                          ? text.getPayload()
                          : message.getClass().getName()));
              // 첫 보내기만 끝내 풀리지 않게 멈춘다 — 막힌 소켓에서 닫기가 시작되는 조건을 만든다.
              if (firstSend.compareAndSet(true, false)) {
                sendEntered.countDown();
                release.await(10, TimeUnit.SECONDS);
              }
              return null;
            })
        .when(rawBrowser)
        .sendMessage(any());

    WebSocketSession rawRunner = mock(WebSocketSession.class);
    when(rawRunner.isOpen()).thenReturn(true);
    when(rawRunner.getId()).thenReturn("runner-1");
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawBrowser)
        .close(any(CloseStatus.class));
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawRunner)
        .close(any(CloseStatus.class));

    UUID id = UUID.randomUUID();
    relay.reserve(id, 1L, 10L, 20L, 30L, Instant.now().plusSeconds(30));
    relay.attachBrowser(id, rawBrowser);
    relay.attachRunner(id, rawRunner);

    Thread runnerOutput = new Thread(() -> relay.fromRunner(id, new BinaryMessage(new byte[64])));
    Thread closer = new Thread(() -> relay.runnerClosed(id, rawRunner));
    try {
      runnerOutput.start();
      assertThat(sendEntered.await(10, TimeUnit.SECONDS)).as("브라우저 목의 첫 보내기에서 멈춰야 한다").isTrue();

      // 닫기는 별도 closer 스레드에서 — 기한(ENDED_DRAIN_TIMEOUT_MS 2_000 + 5_000)만 시간 제한으로 기다린다.
      closer.start();
      closer.join(2_000 + 5_000);
      assertThat(closer.isAlive())
          .as("막혀도 close() 가 ENDED_DRAIN_TIMEOUT_MS + 5_000 ms 안에 반환된다")
          .isFalse();

      // 막혀도 닫힘 자체는 일어난다 — 유한 시간을 넘기면 그냥 닫기로 정한 것이다(끝남 프레임은 없어도 된다).
      assertThat(events).contains("close");
      verify(screenService).recordClosed(eq(1L), eq(id), anyString());
    } finally {
      // 래치는 finally 에서만 풀어, 실패해도 멈춘 스레드가 남지 않게 한다.
      release.countDown();
      runnerOutput.join(10_000);
      closer.join(10_000);
    }
  }

  /**
   * 경계 — 브라우저가 하나도 붙지 않은 채로 닫힐 때(p.browser == null)도 runner 닫기·닫힘 기록까지 예외 없이 가야 한다.
   * closeQuietlyAfterDrain(null, …) 이 NPE 를 내면 이 테스트가 실패한다.
   */
  @Test
  void close_whenNoBrowserAttached_stillClosesRunnerAndRecordsClosed() throws Exception {
    ObjectMapper om = new ObjectMapper();
    AgentScreenRelay relay =
        new AgentScreenRelay(new RunnerSseRegistry(om), new AgentScreenTickets(), om);
    AgentScreenService screenService = mock(AgentScreenService.class);
    relay.setService(screenService);

    UUID id = UUID.randomUUID();
    relay.reserve(id, 1L, 10L, 20L, 30L, Instant.now().plusSeconds(30));

    // Pair 로 가는 공개 길이 없고 pairs 는 private — 리플렉션으로 자리 하나를 꺼내 close(Pair, …) 를 직접 부른다(이 테스트에서만 쓰는
    // 접근).
    Field pairsField = AgentScreenRelay.class.getDeclaredField("pairs");
    pairsField.setAccessible(true);
    @SuppressWarnings("unchecked")
    Map<UUID, AgentScreenRelay.Pair> pairs =
        (Map<UUID, AgentScreenRelay.Pair>) pairsField.get(relay);
    AgentScreenRelay.Pair p = pairs.get(id);
    assertThat(p).as("reserve 한 자리가 남아 있어야 한다").isNotNull();
    assertThat(p.browser).as("attachBrowser 없이 끝낸다").isNull();

    // 브라우저가 없는 세션을 4시간 제한으로 닫는다 — 브라우저가 없어도 기록은 한 번 불려야 한다.
    relay.close(p, "4시간이 지나 닫았어요", true);

    verify(screenService).recordClosed(eq(1L), eq(id), eq("4시간이 지나 닫았어요"));
  }

  /** 경계 — 브라우저가 스스로 닫은 소켓(isOpen == false)에는 끝남 알림도 드레인 대기도 건너뛰어야 한다(닫힌 소켓에 2초를 쓰지 않는다). */
  @Test
  void close_whenBrowserAlreadyClosed_doesNotWaitForDrain() throws Exception {
    ObjectMapper om = new ObjectMapper();
    AgentScreenRelay relay =
        new AgentScreenRelay(new RunnerSseRegistry(om), new AgentScreenTickets(), om);
    AgentScreenService screenService = mock(AgentScreenService.class);
    relay.setService(screenService);

    // 목 소켓에 일어난 일의 순서를 적어 두고 마지막에 단언한다.
    List<String> events = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch sendEntered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicBoolean firstSend = new AtomicBoolean(true);

    WebSocketSession rawBrowser = mock(WebSocketSession.class);
    when(rawBrowser.isOpen()).thenReturn(true);
    when(rawBrowser.getId()).thenReturn("browser-1");
    doAnswer(
            inv -> {
              WebSocketMessage<?> message = inv.getArgument(0);
              events.add(
                  "send:"
                      + (message instanceof TextMessage text
                          ? text.getPayload()
                          : message.getClass().getName()));
              // 첫 보내기만 멈춘다 — 보내는 중인 소켓이 곧 닫히는 조건을 만든다.
              if (firstSend.compareAndSet(true, false)) {
                sendEntered.countDown();
                release.await(10, TimeUnit.SECONDS);
              }
              return null;
            })
        .when(rawBrowser)
        .sendMessage(any());

    WebSocketSession rawRunner = mock(WebSocketSession.class);
    when(rawRunner.isOpen()).thenReturn(true);
    when(rawRunner.getId()).thenReturn("runner-1");
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawBrowser)
        .close(any(CloseStatus.class));
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawRunner)
        .close(any(CloseStatus.class));

    UUID id = UUID.randomUUID();
    relay.reserve(id, 1L, 10L, 20L, 30L, Instant.now().plusSeconds(30));
    relay.attachBrowser(id, rawBrowser);
    relay.attachRunner(id, rawRunner);

    Thread runnerOutput = new Thread(() -> relay.fromRunner(id, new BinaryMessage(new byte[64])));
    Thread closer = new Thread(() -> relay.runnerClosed(id, rawRunner));
    try {
      runnerOutput.start();
      assertThat(sendEntered.await(10, TimeUnit.SECONDS)).as("브라우저 목의 첫 보내기에서 멈춰야 한다").isTrue();

      // 브라우저가 스스로 닫은 상태로 바꾼다 — 끝남 알림·드레인 대기 모두 이 판정에 걸려야 한다.
      when(rawBrowser.isOpen()).thenReturn(false);

      long start = System.currentTimeMillis();
      closer.start();
      closer.join(5_000);
      long elapsed = System.currentTimeMillis() - start;
      assertThat(closer.isAlive()).as("닫기가 500 ms 안에 끝난다").isFalse();
      assertThat(elapsed).as("이미 닫힌 소켓에 ENDED_DRAIN_TIMEOUT_MS(2_000) 를 쓰지 않는다").isLessThan(500);

      assertThat(events)
          .as("열려 있지 않은 브라우저에는 끝남 알림을 보내지 않는다")
          .noneMatch(e -> e.contains("\"state\":\"ended\""));
      assertThat(events).contains("close");
      verify(screenService).recordClosed(eq(1L), eq(id), anyString());
    } finally {
      // 래치는 finally 에서만 풀어, 실패해도 멈춘 스레드가 남지 않게 한다.
      release.countDown();
      runnerOutput.join(10_000);
      closer.join(10_000);
    }
  }

  /** 경계 — 드레인 대기 중 인터럽트를 받아도 닫힘이 지연·유실되지 않아야 한다(대기는 플래그를 되돌리고 끊고 곧바로 닫는다). */
  @Test
  void close_whenInterruptedWhileWaiting_stillCloses() throws Exception {
    ObjectMapper om = new ObjectMapper();
    AgentScreenRelay relay =
        new AgentScreenRelay(new RunnerSseRegistry(om), new AgentScreenTickets(), om);
    AgentScreenService screenService = mock(AgentScreenService.class);
    relay.setService(screenService);

    // 목 소켓에 일어난 일의 순서를 적어 두고 마지막에 단언한다.
    List<String> events = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch sendEntered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicBoolean firstSend = new AtomicBoolean(true);

    WebSocketSession rawBrowser = mock(WebSocketSession.class);
    when(rawBrowser.isOpen()).thenReturn(true);
    when(rawBrowser.getId()).thenReturn("browser-1");
    doAnswer(
            inv -> {
              WebSocketMessage<?> message = inv.getArgument(0);
              events.add(
                  "send:"
                      + (message instanceof TextMessage text
                          ? text.getPayload()
                          : message.getClass().getName()));
              // 첫 보내기만 영구히 멈춘다 — 대기가 끝까지 이어지는 판을 만든다.
              if (firstSend.compareAndSet(true, false)) {
                sendEntered.countDown();
                release.await(10, TimeUnit.SECONDS);
              }
              return null;
            })
        .when(rawBrowser)
        .sendMessage(any());

    WebSocketSession rawRunner = mock(WebSocketSession.class);
    when(rawRunner.isOpen()).thenReturn(true);
    when(rawRunner.getId()).thenReturn("runner-1");
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawBrowser)
        .close(any(CloseStatus.class));
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawRunner)
        .close(any(CloseStatus.class));

    UUID id = UUID.randomUUID();
    relay.reserve(id, 1L, 10L, 20L, 30L, Instant.now().plusSeconds(30));
    relay.attachBrowser(id, rawBrowser);
    relay.attachRunner(id, rawRunner);

    Thread runnerOutput = new Thread(() -> relay.fromRunner(id, new BinaryMessage(new byte[64])));
    // close() 반환 직후의 인터럽트 플래그 — 대기가 플래그를 되살리고 끊었는지까지 검별하기 위해 적어 둔다.
    AtomicBoolean interruptFlagAfterClose = new AtomicBoolean();
    Thread closer =
        new Thread(
            () -> {
              relay.runnerClosed(id, rawRunner);
              interruptFlagAfterClose.set(Thread.currentThread().isInterrupted());
            });
    try {
      runnerOutput.start();
      assertThat(sendEntered.await(10, TimeUnit.SECONDS)).as("브라우저 목의 첫 보내기에서 멈춰야 한다").isTrue();

      long start = System.currentTimeMillis();
      closer.start();
      // 닫기가 드레인 대기에 들어갔다고 본다 — 막힌 보내기가 풀리지 않으니 대기는 이어진다.
      Thread.sleep(200);
      assertThat(closer.isAlive()).as("막힌 보내기가 있는 동안 드레인 대기 중이어야 한다").isTrue();
      closer.interrupt();
      closer.join(2_000 + 5_000);
      long elapsed = System.currentTimeMillis() - start;

      assertThat(closer.isAlive())
          .as("대기 중 인터럽트에도 close() 가 ENDED_DRAIN_TIMEOUT_MS + 5_000 ms 안에 반환된다")
          .isFalse();
      // 7초 기한은 "인터럽트를 무시하고 드레인 상한 2초를 그대로 채우는" 회귀(elapsed≈2.0s)도 통과해 검별이 안 된다 —
      // 인터럽트는 200ms 부근에서 들어오므로 조기 이탈(≈0.21s)과 무시형 회귀를 갈라 주도록 1초로 조인다(WP-2015 Review Focus 5).
      assertThat(elapsed).isLessThan(1_000);
      assertThat(interruptFlagAfterClose.get()).as("대기는 인터럽트 플래그를 되살린 채로 끊는다").isTrue();
      assertThat(events).contains("close");
    } finally {
      // 래치는 finally 에서만 풀어, 실패해도 멈춘 스레드가 남지 않게 한다.
      release.countDown();
      runnerOutput.join(10_000);
      closer.join(10_000);
    }
  }

  /**
   * 경계(계획 Review Focus 4) — 보내는 중이 아닐 때는 드레인 대기 루프가 한 번도 돌지 않고 바로 닫혀야 한다(타이머 틱 하나만큼의 지연도 없이). 래치는
   * 두지만 멈추는 구간이 없어 아무 스레드도 막히지 않는다.
   */
  @Test
  void close_withoutStalledSend_returnsWithoutWaiting() throws Exception {
    ObjectMapper om = new ObjectMapper();
    AgentScreenRelay relay =
        new AgentScreenRelay(new RunnerSseRegistry(om), new AgentScreenTickets(), om);
    AgentScreenService screenService = mock(AgentScreenService.class);
    relay.setService(screenService);

    // 목 소켓에 일어난 일의 순서를 적어 두고 마지막에 단언한다.
    List<String> events = Collections.synchronizedList(new ArrayList<>());

    WebSocketSession rawBrowser = mock(WebSocketSession.class);
    when(rawBrowser.isOpen()).thenReturn(true);
    when(rawBrowser.getId()).thenReturn("browser-1");
    doAnswer(
            inv -> {
              WebSocketMessage<?> message = inv.getArgument(0);
              events.add(
                  "send:"
                      + (message instanceof TextMessage text
                          ? text.getPayload()
                          : message.getClass().getName()));
              return null;
            })
        .when(rawBrowser)
        .sendMessage(any());

    WebSocketSession rawRunner = mock(WebSocketSession.class);
    when(rawRunner.isOpen()).thenReturn(true);
    when(rawRunner.getId()).thenReturn("runner-1");
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawBrowser)
        .close(any(CloseStatus.class));
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(rawRunner)
        .close(any(CloseStatus.class));

    UUID id = UUID.randomUUID();
    relay.reserve(id, 1L, 10L, 20L, 30L, Instant.now().plusSeconds(30));
    relay.attachBrowser(id, rawBrowser);
    relay.attachRunner(id, rawRunner);

    Thread closer = new Thread(() -> relay.runnerClosed(id, rawRunner));
    long start = System.currentTimeMillis();
    closer.start();
    closer.join(5_000);
    long elapsed = System.currentTimeMillis() - start;

    assertThat(closer.isAlive()).as("대기 없이 반환된다").isFalse();
    assertThat(elapsed)
        .as("보내는 중이 아닐 때는 드레인 대기 없이 바로 닫힌다(ENDED_DRAIN_TIMEOUT_MS 미만)")
        .isLessThan(500);

    // 평상시에도 끝남 알림은 소켓으로 나가고, 그 뒤에 닫힘이 온다.
    assertThat(events)
        .anyMatch(e -> e.startsWith("send:") && e.contains("\"state\":\"ended\""))
        .contains("close");
    assertThat(endedFrameIndex(events))
        .as("끝남 프레임이 닫힘 기록보다 앞선다")
        .isLessThan(events.indexOf("close"));
    verify(screenService).recordClosed(eq(1L), eq(id), anyString());
  }

  /**
   * 회귀(6번 리뷰 지적 1) — 라이브러리는 쓰기 시작한 그 밀리초에는 진행 중인 보내기를 0 으로 보여 줘 드레인이 유휴로 오판할 수 있다. 그 오탐을 10ms 로 넓혀
   * 재현한 데코레이터로, 오탐 유휴에서 재확인 없이 나가면 진행 중인 쓰기가 끝나기 전에 닫혀 기록 순서가 뒤바뀐다(WP-2015).
   */
  @Test
  void closeQuietlyAfterDrain_whenSendStartsInSameMillisecond_waitsForInFlightSend()
      throws Exception {
    List<String> events = Collections.synchronizedList(new ArrayList<>());
    CountDownLatch sendStarted = new CountDownLatch(1);
    // 목을 만들 때는 데코레이터가 아직 없으니 홀더로 참조를 넘겨, sendMessage 안에서 데코레이터를 잡아 세운다.
    BlindSpotSessionDecorator[] holder = new BlindSpotSessionDecorator[1];
    // 리플렉션은 미리 꺼내 둔다 — 보내기가 시작된 뒤에 찾으면 찾는 시간이 유휴 오탐 안에 끼어들어 판을 흐릴 수 있다.
    Method closeAfterDrain =
        AgentScreenRelay.class.getDeclaredMethod(
            "closeQuietlyAfterDrain", WebSocketSession.class, CloseStatus.class);
    closeAfterDrain.setAccessible(true);

    WebSocketSession raw = mock(WebSocketSession.class);
    when(raw.isOpen()).thenReturn(true);
    when(raw.getId()).thenReturn("blind-1");
    doAnswer(
            inv -> {
              // 버퍼를 비우고 sendStartTime 을 쓴 직후다 — 그 순간부터 10ms 는 진행 중인 보내기를 0 으로 보이게 한다.
              holder[0].blindUntilNanos = System.nanoTime() + 10_000_000L;
              sendStarted.countDown();
              // 진행 중인 보내기가 300ms 동안 이어지게 한다 — 그 안에 닫히면 끝남 프레임이 유실된 재현이다.
              Thread.sleep(300);
              // 프레임이 실제로 나간 뒤에 기록한다 — 뒤바뀐 순서를 이 줄이 잡는다.
              events.add("send-done");
              return null;
            })
        .when(raw)
        .sendMessage(any());
    doAnswer(
            inv -> {
              events.add("close");
              return null;
            })
        .when(raw)
        .close(any(CloseStatus.class));

    BlindSpotSessionDecorator blind = new BlindSpotSessionDecorator(raw);
    holder[0] = blind;

    Thread sender =
        new Thread(
            () -> {
              try {
                blind.sendMessage(new TextMessage("{\"state\":\"ended\"}"));
              } catch (IOException e) {
                events.add("send-error:" + e);
              }
            },
            "blind-sender");
    try {
      sender.start();
      assertThat(sendStarted.await(5, TimeUnit.SECONDS))
          .as("목의 sendMessage 가 불려 데코레이터가 유휴으로 보이게 된다")
          .isTrue();

      closeAfterDrain.invoke(null, blind, CloseStatus.NORMAL);

      sender.join(5_000);
      assertThat(sender.isAlive()).as("보내기 스레드가 끝난다").isFalse();
      assertThat(events).contains("send-done", "close");
      // 핵심 — 진행 중인 쓰기가 끝나기 전에 닫히면 이 순서가 뒤집혀 실패한다.
      assertThat(events.indexOf("send-done"))
          .as("끝남 프레임의 보내기가 끝난 뒤에 닫힌다")
          .isLessThan(events.indexOf("close"));
    } finally {
      // 스레드는 반드시 정리한다 — 실패해도 비데몬 sender 가 남지 않게 한다.
      sender.join(10_000);
    }
  }

  /** 끝남 프레임이 처음 기록된 자리 — 닫힘 기록의 자리보다 앞서야 한다. */
  private static int endedFrameIndex(List<String> events) {
    return IntStream.range(0, events.size())
        .filter(i -> events.get(i).contains("\"state\":\"ended\""))
        .findFirst()
        .orElseThrow();
  }

  /**
   * 유휴 판정의 오탐을 10ms 로 넓힌 데코레이터 — raw 세션의 sendMessage 가 불리는 순간부터 10ms 동안 진행 중인 보내기를 0 으로 보여
   * 준다(라이브러리가 쓰기 시작한 그 밀리초에 0 을 보여 주는 동작을 시간으로 넓혀 재현한 것, WP-2015).
   */
  private static final class BlindSpotSessionDecorator extends ConcurrentWebSocketSessionDecorator {

    volatile long blindUntilNanos;

    BlindSpotSessionDecorator(WebSocketSession delegate) {
      super(delegate, 10_000, 64 * 1024);
    }

    @Override
    public long getTimeSinceSendStarted() {
      return System.nanoTime() < blindUntilNanos ? 0 : super.getTimeSinceSendStarted();
    }
  }
}
