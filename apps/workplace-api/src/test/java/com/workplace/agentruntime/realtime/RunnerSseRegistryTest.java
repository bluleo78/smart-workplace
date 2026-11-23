package com.workplace.agentruntime.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.workplace.global.realtime.relay.RelayMessage;
import com.workplace.global.realtime.relay.SseEventRelay;
import org.junit.jupiter.api.Test;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** runner 레지스트리의 닫힘 신호 고정(WP-1973 리뷰) — 발행 파드의 로컬 연결도 발행과 무관하게 곧바로 닫힌다. */
class RunnerSseRegistryTest {

  /**
   * 발행이 도착하지 않아도 로컬 emitter 는 닫힌다(WP-1973 리뷰) — {@code SseRegistry.closeAll} 과 같은 까닭이다: 중계로만 닫으면 발행
   * 커넥션 끊김·발행 큐 넘침·LISTEN 재연결 백오프 동안 그 파드의 runner 스트림이 살아남는다(토큰 재발급·위치 삭제 뒤 옛 토큰 유출).
   */
  @Test
  void closeAll_발행이_도착하지_않아도_로컬을_닫는다() {
    SseEventRelay 끊긴_중계 = mock(SseEventRelay.class); // publish 가 전달을 만들지 않는다 — 끊긴 발행·LISTEN 경로
    RunnerSseRegistry 대상 = new RunnerSseRegistry(끊긴_중계);
    SseEmitter emitter = 대상.register(1L, 2L);

    대상.closeAll(1L, 2L);

    assertThat(대상.connectionCount(1L, 2L)).as("발행과 무관하게 로컬 연결이 정리된다").isZero();
    assertThatThrownBy(() -> emitter.send(SseEmitter.event().comment("probe")))
        .as("로컬 emitter 는 바로 닫힌다")
        .isInstanceOf(IllegalStateException.class);
    verify(끊긴_중계).publish(RelayMessage.closeRunner(1L, 2L));
  }
}
