package com.workplace.mail.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/**
 * 보낼 대기열 멈춤 정리 간격(WP-1786) — 잡기는 5초 회차마다 하지만 멈춤 정리(10분 기준)는 간격(운영 기본 1분)이 지난 회차에만 한다. 시각을 인자로 넘겨
 * 스프링 없이 본다.
 */
class MailSendQueueSweepTurnTest {

  private static final long SEC = 1_000_000_000L;

  private static MailSendQueueScheduler scheduler(Duration interval) {
    return new MailSendQueueScheduler(null, null, null, null, null, interval);
  }

  @Test
  void 첫_회차는_정리하고_간격_안의_회차는_건너뛰며_간격이_지나면_다시_정리한다() {
    MailSendQueueScheduler s = scheduler(Duration.ofMinutes(1));

    assertThat(s.takeSweepTurn(100 * SEC)).isTrue();
    assertThat(s.takeSweepTurn(105 * SEC)).isFalse();
    assertThat(s.takeSweepTurn(159 * SEC)).isFalse();
    assertThat(s.takeSweepTurn(160 * SEC)).isTrue();
    assertThat(s.takeSweepTurn(165 * SEC)).isFalse();
  }

  @Test
  void 간격이_0_이면_회차마다_정리한다() {
    MailSendQueueScheduler s = scheduler(Duration.ZERO);

    assertThat(s.takeSweepTurn(1 * SEC)).isTrue();
    assertThat(s.takeSweepTurn(1 * SEC)).isTrue();
  }
}
