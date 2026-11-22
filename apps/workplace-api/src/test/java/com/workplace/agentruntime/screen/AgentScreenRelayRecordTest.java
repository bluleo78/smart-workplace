package com.workplace.agentruntime.screen;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * WP-2014 작업 화면 입력 기록 — 기록을 먼저 하고 보내기, 쓰기 실패 덩어리 되돌려 쓰기, 닫을 때 마지막 쓰기 실패 로그를 본다. 실제 소켓·DB 없이 mock 으로
 * 검증한다(타이머가 끼어들어도 결과가 같은 단언만 쓴다).
 */
class AgentScreenRelayRecordTest {

  private static final long TENANT = 1L;

  private AgentScreenRelay relay;
  private AgentScreenService service;
  private WebSocketSession runner;
  private AgentScreenRelay.Pair pair;
  private UUID id;
  private ListAppender<ILoggingEvent> logs;
  private Logger relayLogger;

  @BeforeEach
  void setUp() {
    relay =
        new AgentScreenRelay(
            mock(RunnerSseRegistry.class), mock(AgentScreenTickets.class), new ObjectMapper());
    service = mock(AgentScreenService.class);
    relay.setService(service);
    relay.stopTimerForTest();
    id = UUID.randomUUID();
    relay.reserve(id, TENANT, 2L, 3L, 4L, Instant.now().plusSeconds(600));
    pair = relay.pairOf(id);
    runner = mock(WebSocketSession.class);
    when(runner.isOpen()).thenReturn(true);
    pair.runner = runner;
    pair.inputEnabled = true;
    relayLogger = (Logger) LoggerFactory.getLogger(AgentScreenRelay.class);
    logs = new ListAppender<>();
    logs.start();
    relayLogger.addAppender(logs);
  }

  @AfterEach
  void tearDown() {
    relayLogger.detachAppender(logs);
    relay.shutdown();
  }

  private void key(String s) {
    relay.fromBrowserBinary(id, new BinaryMessage(s.getBytes(StandardCharsets.UTF_8)));
  }

  /** recordInput 이 정확히 n 번 불렸는지 확인하고 넘긴 덩어리 목록들을 부른 순서대로 돌려준다. */
  private List<List<String>> writes(int n) {
    @SuppressWarnings("unchecked")
    ArgumentCaptor<List<String>> cap = ArgumentCaptor.forClass(List.class);
    verify(service, times(n)).recordInput(eq(TENANT), eq(id), cap.capture());
    return cap.getAllValues();
  }

  /** 잡힌 로그 중 해당 수준만. */
  private List<ILoggingEvent> logsAt(Level level) {
    return logs.list.stream().filter(e -> e.getLevel() == level).toList();
  }

  @Test
  void fromBrowserBinary_afterFinalDrain_isNotSentToRunner() throws Exception {
    pair.recorder.drain(true);

    key("x");

    verify(runner, never()).sendMessage(any(WebSocketMessage.class));
    assertThat(pair.recorder.drain(false)).isEmpty();
  }

  @Test
  void fromBrowserBinary_beforeClose_isRecordedInFinalWrite() throws Exception {
    key("ls");
    relay.close(pair, "t", false);

    verify(service, times(1)).recordInput(TENANT, id, List.of("ls"));
    verify(runner).sendMessage(any(WebSocketMessage.class));
  }

  @Test
  void flush_whenFirstWriteFails_nextWriteRecordsSameInputOnceInOrder() {
    doThrow(new RuntimeException("db"))
        .doNothing()
        .when(service)
        .recordInput(anyLong(), any(), anyList());

    key("a");
    relay.tick();
    key("b");
    relay.tick();

    assertThat(writes(2).get(1)).containsExactly("a", "b");

    relay.close(pair, "t", false);
    verify(service, times(2)).recordInput(eq(TENANT), eq(id), anyList());
  }

  @Test
  void flush_whenFinalWriteFailsTwice_logsErrorWithCounts() {
    doThrow(new RuntimeException("db")).when(service).recordInput(anyLong(), any(), anyList());

    key("abc");
    relay.close(pair, "t", false);

    verify(service, times(2)).recordInput(eq(TENANT), eq(id), anyList());
    List<ILoggingEvent> errors = logsAt(Level.ERROR);
    assertThat(errors).hasSize(1);
    String msg = errors.get(0).getFormattedMessage();
    assertThat(msg).contains(id.toString()).contains("chunks=1").contains("chars=3");
  }

  @Test
  void flush_whenTickWriteFailsThenClose_finalWriteHasBothInOrder() {
    doThrow(new RuntimeException("db"))
        .doNothing()
        .when(service)
        .recordInput(anyLong(), any(), anyList());

    key("a");
    relay.tick();
    key("b");
    relay.close(pair, "t", false);

    assertThat(writes(2).get(1)).containsExactly("a", "b");
  }

  /** 타이머 쓰기가 상한만큼 연속 실패하면 그 덩어리를 버리고(ERROR 1줄), 이후 입력은 "a" 없이 기록된다. */
  @Test
  void flush_whenTickWriteFailsRepeatedly_dropsAfterRetryLimitAndRecordsLaterInput() {
    AtomicInteger calls = new AtomicInteger();
    doAnswer(
            inv -> {
              if (calls.incrementAndGet() <= AgentScreenRelay.MAX_FLUSH_RETRIES) {
                throw new RuntimeException("db");
              }
              return null;
            })
        .when(service)
        .recordInput(anyLong(), any(), anyList());

    key("a");
    for (int i = 0; i < AgentScreenRelay.MAX_FLUSH_RETRIES; i++) relay.tick();

    List<ILoggingEvent> errors = logsAt(Level.ERROR);
    assertThat(errors).hasSize(1);
    assertThat(errors.get(0).getFormattedMessage()).contains("chunks=1").contains("chars=1");

    key("b");
    relay.tick();

    List<List<String>> all = writes(AgentScreenRelay.MAX_FLUSH_RETRIES + 1);
    assertThat(all.get(all.size() - 1)).containsExactly("b");
  }

  /** 연속 실패는 첫 번째만 WARN 이다. */
  @Test
  void flush_whenTickWriteFailsTwice_warnsOnlyOnce() {
    doThrow(new RuntimeException("db")).when(service).recordInput(anyLong(), any(), anyList());

    key("a");
    relay.tick();
    relay.tick();

    assertThat(logsAt(Level.WARN)).hasSize(1);
  }
}
