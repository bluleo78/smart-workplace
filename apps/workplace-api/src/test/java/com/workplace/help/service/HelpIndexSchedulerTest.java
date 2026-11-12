package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** HelpIndexScheduler — 10분 간격 판단(첫 틱·성공 뒤 건너뜀·실패 뒤 재시도)을 가짜 시계로 확인한다. */
class HelpIndexSchedulerTest {

  /** 손으로 앞으로 감는 시계. */
  static class MutableClock extends Clock {
    Instant now = Instant.parse("2026-01-01T00:00:00Z");

    @Override
    public java.time.ZoneId getZone() {
      return ZoneOffset.UTC;
    }

    @Override
    public Clock withZone(java.time.ZoneId z) {
      return this;
    }

    @Override
    public Instant instant() {
      return now;
    }
  }

  @Test
  void refreshesOnFirstTick() {
    HelpManualIndexer idx = mock(HelpManualIndexer.class);
    when(idx.refresh()).thenReturn(true);
    new HelpIndexScheduler(idx, new MutableClock()).refresh();
    verify(idx, times(1)).refresh();
  }

  @Test
  void skipsWithinTenMinutesAfterSuccess() {
    HelpManualIndexer idx = mock(HelpManualIndexer.class);
    when(idx.refresh()).thenReturn(true);
    MutableClock clock = new MutableClock();
    HelpIndexScheduler s = new HelpIndexScheduler(idx, clock);
    s.refresh();
    clock.now = clock.now.plus(Duration.ofMinutes(9));
    s.refresh();
    verify(idx, times(1)).refresh();
    clock.now = clock.now.plus(Duration.ofMinutes(2));
    s.refresh();
    verify(idx, times(2)).refresh();
  }

  @Test
  void retriesNextTickAfterFailure() {
    HelpManualIndexer idx = mock(HelpManualIndexer.class);
    when(idx.refresh()).thenReturn(false, true);
    MutableClock clock = new MutableClock();
    HelpIndexScheduler s = new HelpIndexScheduler(idx, clock);
    s.refresh();
    clock.now = clock.now.plusSeconds(60);
    s.refresh();
    verify(idx, times(2)).refresh();
    assertThat(clock.now).isNotNull();
  }
}
