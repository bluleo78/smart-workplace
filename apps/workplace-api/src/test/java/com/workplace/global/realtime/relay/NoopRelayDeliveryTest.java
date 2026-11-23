package com.workplace.global.realtime.relay;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.workplace.agentruntime.realtime.RunnerSseRegistry;
import com.workplace.global.realtime.SseRegistry;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 중계를 끈(Noop) 상태의 동작 고정(WP-1973) — 지금과 같은 로컬 직행과 발행-중계 분리. */
class NoopRelayDeliveryTest {

  /** 중계가 꺼지면 publish 가 등록된 수신자에게 곧바로(동기) 전달돼 지금처럼 로컬로 바로 간다. */
  @Test
  void 중계가_꺼지면_지금처럼_로컬로_바로_간다() {
    NoopSseEventRelay relay = new NoopSseEventRelay();
    List<RelayMessage> 받은_메시지 = new ArrayList<>();
    relay.onMessage(받은_메시지::add);

    RelayMessage 메시지 =
        new RelayMessage(RelayMessage.TARGET_USER, "notify.created", "{\"a\":1}", "[7]");
    relay.publish(메시지);

    // 대기·비동기 없이 publish 가 반환된 시점에 이미 같은 메시지가 와 있어야 한다.
    assertThat(받은_메시지).containsExactly(메시지);
  }

  /** fanOut 은 로컬로 직접 보내지 않고 중계로만 발행한다 — 실제 전달은 수신 경로(deliverLocal) 한 곳에서. */
  @Test
  void SseRegistry_fanOut_이_relay로_발행한다() {
    SseEventRelay relay = mock(SseEventRelay.class);
    SseRegistry registry = new SseRegistry(relay);

    registry.fanOut(Set.of(1L), "notify.created", Map.of("a", 1));

    ArgumentCaptor<RelayMessage> 보냄 = ArgumentCaptor.forClass(RelayMessage.class);
    verify(relay, times(1)).publish(보냄.capture());
    RelayMessage 발행됨 = 보냄.getValue();
    assertThat(발행됨.target()).isEqualTo(RelayMessage.TARGET_USER);
    assertThat(발행됨.event()).isEqualTo("notify.created");
    assertThat(발행됨.payloadJson()).isEqualTo("{\"a\":1}");
    assertThat(발행됨.keysJson()).isEqualTo("[1]");
  }

  /** closeAll 은 user.close 로 발행한다 — 정지 멤버 닫힘 신호에 event·payload 는 없고 keysJson(대상 userId) 만 실린다. */
  @Test
  void SseRegistry_closeAll이_user_close로_발행한다() {
    SseEventRelay relay = mock(SseEventRelay.class);
    SseRegistry registry = new SseRegistry(relay);

    registry.closeAll(7L);

    ArgumentCaptor<RelayMessage> 보냄 = ArgumentCaptor.forClass(RelayMessage.class);
    verify(relay, times(1)).publish(보냄.capture());
    RelayMessage 발행됨 = 보냄.getValue();
    assertThat(발행됨.target()).isEqualTo(RelayMessage.TARGET_USER_CLOSE);
    assertThat(발행됨.event()).isNull();
    assertThat(발행됨.payloadJson()).isNull();
    assertThat(발행됨.keysJson()).isEqualTo("[7]");
  }

  /** send 는 runner 로 (테넌트, 위치) 키를 실어 발행한다 — dispatcher 가 그 키로 자기 파드의 runner 연결에만 전달한다. */
  @Test
  void RunnerSseRegistry_send가_relay로_발행한다() {
    SseEventRelay relay = mock(SseEventRelay.class);
    RunnerSseRegistry registry = new RunnerSseRegistry(relay);

    registry.send(1L, 2L, "runner.location.updated", Map.of("a", 1));

    ArgumentCaptor<RelayMessage> 보냄 = ArgumentCaptor.forClass(RelayMessage.class);
    verify(relay, times(1)).publish(보냄.capture());
    RelayMessage 발행됨 = 보냄.getValue();
    assertThat(발행됨.target()).isEqualTo(RelayMessage.TARGET_RUNNER);
    assertThat(발행됨.event()).isEqualTo("runner.location.updated");
    assertThat(발행됨.payloadJson()).isEqualTo("{\"a\":1}");
    assertThat(발행됨.keysJson()).isEqualTo("[1,2]");
  }

  /** closeAll 은 runner.close 로 같은 (테넌트, 위치) 키를 실어 발행한다 — runner 닫힘 신호의 형태. */
  @Test
  void RunnerSseRegistry_closeAll이_runner_close로_발행한다() {
    SseEventRelay relay = mock(SseEventRelay.class);
    RunnerSseRegistry registry = new RunnerSseRegistry(relay);

    registry.closeAll(1L, 2L);

    ArgumentCaptor<RelayMessage> 보냄 = ArgumentCaptor.forClass(RelayMessage.class);
    verify(relay, times(1)).publish(보냄.capture());
    RelayMessage 발행됨 = 보냄.getValue();
    assertThat(발행됨.target()).isEqualTo(RelayMessage.TARGET_RUNNER_CLOSE);
    assertThat(발행됨.event()).isNull();
    assertThat(발행됨.payloadJson()).isNull();
    assertThat(발행됨.keysJson()).isEqualTo("[1,2]");
  }

  /**
   * 수신 배선의 실패는 발행자로 번지지 않는다(WP-1973 Task 3 이월) — 레지스트리 예외·깨진 keysJson·짧은 runner 키는 전부 경고로 끝나고, Noop
   * 의 동기 경로로 발행자를 때려도 예외가 올라가지 않는다(중계 best-effort 계약). runner 는 키가 두 개라야 전달한다.
   */
  @Test
  void 중계_수신의_실패가_발행자로_번지지_않는다() {
    NoopSseEventRelay relay = new NoopSseEventRelay();
    SseRegistry sseRegistry = mock(SseRegistry.class);
    RunnerSseRegistry runnerRegistry = mock(RunnerSseRegistry.class);
    doThrow(new IllegalStateException("터진 레지스트리"))
        .when(sseRegistry)
        .deliverLocal(any(), any(), any());
    new RelayLocalDispatcher(sseRegistry, runnerRegistry, relay).register();

    assertThatCode(
            () -> {
              relay.publish(
                  new RelayMessage(RelayMessage.TARGET_USER, "e", "{}", "[7]")); // 레지스트리 예외
              relay.publish(
                  new RelayMessage(RelayMessage.TARGET_USER, "e", "{}", "깨진-json")); // keys 파싱 실패
              relay.publish(
                  new RelayMessage(RelayMessage.TARGET_RUNNER, "e", "{}", "[1]")); // runner 키가 하나뿐
              relay.publish(
                  new RelayMessage(
                      RelayMessage.TARGET_RUNNER_CLOSE, null, null, "[1]")); // 닫힘도 같은 가드
            })
        .doesNotThrowAnyException();
    verify(runnerRegistry, never()).deliverLocal(any(), any(), anyLong(), anyLong());
    verify(runnerRegistry, never()).closeLocal(anyLong(), anyLong());
  }
}
