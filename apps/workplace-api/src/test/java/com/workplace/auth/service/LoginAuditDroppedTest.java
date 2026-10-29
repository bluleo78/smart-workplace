package com.workplace.auth.service;

import static org.assertj.core.api.Assertions.assertThat;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;

/**
 * WP-1161 — 로그인 실패 감사 큐가 넘쳐 버린 건은 메트릭으로 모두 세고, 경고 로그는 1분마다(flush) 그동안 버린 건수를 모아 남긴다 — 버릴 때마다 요청
 * 스레드에서 쓰지 않고, 버림이 멈춰도 마지막 묶음이 다음 flush 에 남는다.
 */
class LoginAuditDroppedTest {

  @Test
  void 버린_건은_메트릭으로_모두_세고_flush_가_모인_건수를_비운다() {
    Counter counter = new SimpleMeterRegistry().counter(LoginAuditConfig.DROPPED_METRIC);
    var dropped = new LoginAuditConfig.DroppedAudits(counter);

    for (int i = 0; i < 3; i++) dropped.drop();
    assertThat(dropped.pending()).isEqualTo(3);

    dropped.flush();
    assertThat(dropped.pending()).isZero();

    dropped.drop();
    dropped.flush();
    dropped.flush(); // 버린 것이 없으면 아무것도 하지 않는다.
    assertThat(dropped.pending()).isZero();
    assertThat(counter.count()).isEqualTo(4.0);
  }
}
