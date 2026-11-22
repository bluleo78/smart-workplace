package com.workplace.help.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import net.javacrumbs.shedlock.core.ClockProvider;
import net.javacrumbs.shedlock.core.DefaultLockingTaskExecutor;
import net.javacrumbs.shedlock.core.LockConfiguration;
import net.javacrumbs.shedlock.core.LockProvider;
import net.javacrumbs.shedlock.core.SimpleLock;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.junit.jupiter.api.Test;

/** HelpIndexScheduler — 성공한 실행은 10분 간격으로, 실패한 실행은 다음 틱부터 재시도한다. */
class HelpIndexSchedulerTest {

  private static final String LOCK_NAME = "HelpIndexScheduler.refresh";
  private static final Duration LOCK_AT_MOST = Duration.ofMinutes(30);
  private static final Duration LOCK_AT_LEAST = Duration.ofSeconds(10);

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

  /** 실패 재시도를 위해 최소 잠금은 10초, 비정상 종료 대비 최대 잠금은 30분인지 확인한다. */
  @Test
  void schedulerLockMinimumDurationAllowsRetryOnNextTick() throws NoSuchMethodException {
    SchedulerLock schedulerLock =
        HelpIndexScheduler.class.getMethod("refresh").getAnnotation(SchedulerLock.class);
    assertThat(Duration.parse(schedulerLock.lockAtLeastFor())).isEqualTo(LOCK_AT_LEAST);
    assertThat(Duration.parse(schedulerLock.lockAtMostFor())).isEqualTo(LOCK_AT_MOST);
  }

  @Test
  void extendsLockOnSuccessfulRefreshForFullMinimumInterval() {
    HelpManualIndexer idx = mock(HelpManualIndexer.class);
    MutableClock clock = new MutableClock();
    when(idx.refresh())
        .thenAnswer(
            invocation -> {
              clock.now = clock.now.plus(Duration.ofMinutes(2));
              return true;
            });
    LockProvider provider = mock(LockProvider.class);
    SimpleLock lock = mock(SimpleLock.class);
    SimpleLock extendedLock = mock(SimpleLock.class);
    when(provider.lock(any())).thenReturn(Optional.of(lock));
    when(lock.extend(LOCK_AT_MOST, Duration.ofMinutes(10))).thenReturn(Optional.of(extendedLock));

    runUnderLock(new HelpIndexScheduler(idx, clock), provider);

    verify(lock).extend(LOCK_AT_MOST, Duration.ofMinutes(10));
    verify(lock, never()).unlock();
    verify(extendedLock).unlock();
  }

  @Test
  void doesNotExtendLockWhenSuccessfulRefreshAlreadyTookTenMinutes() {
    HelpManualIndexer idx = mock(HelpManualIndexer.class);
    MutableClock clock = new MutableClock();
    when(idx.refresh())
        .thenAnswer(
            invocation -> {
              clock.now = clock.now.plus(Duration.ofMinutes(11));
              return true;
            });
    LockProvider provider = mock(LockProvider.class);
    SimpleLock lock = mock(SimpleLock.class);
    when(provider.lock(any())).thenReturn(Optional.of(lock));

    runUnderLock(new HelpIndexScheduler(idx, clock), provider);

    verify(lock, never()).extend(any(Duration.class), any(Duration.class));
    verify(lock).unlock();
  }

  @Test
  void failedRefreshReleasesWithoutExtendingTheLock() {
    HelpManualIndexer idx = mock(HelpManualIndexer.class);
    when(idx.refresh()).thenReturn(false);
    LockProvider provider = mock(LockProvider.class);
    SimpleLock lock = mock(SimpleLock.class);
    when(provider.lock(any())).thenReturn(Optional.of(lock));

    runUnderLock(new HelpIndexScheduler(idx, new MutableClock()), provider);

    verify(lock, never()).extend(any(Duration.class), any(Duration.class));
    verify(lock).unlock();
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

  /** 실패는 성공 시각을 갱신하지 않아 다음 1분 틱에 재시도한다. */
  @Test
  void retriesOnNextTickAfterFailure() {
    HelpManualIndexer idx = mock(HelpManualIndexer.class);
    when(idx.refresh()).thenReturn(false, true);
    MutableClock clock = new MutableClock();
    HelpIndexScheduler s = new HelpIndexScheduler(idx, clock);
    s.refresh();
    clock.now = clock.now.plusSeconds(60);
    s.refresh();
    verify(idx, times(2)).refresh();
  }

  private static void runUnderLock(HelpIndexScheduler scheduler, LockProvider provider) {
    new DefaultLockingTaskExecutor(provider)
        .executeWithLock(
            (Runnable) scheduler::refresh,
            new LockConfiguration(ClockProvider.now(), LOCK_NAME, LOCK_AT_MOST, LOCK_AT_LEAST));
  }
}
