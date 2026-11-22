package com.workplace.help.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.core.LockExtender;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 도움말 색인 주기 실행(WP-1509) — 1분마다 깨어나되 마지막 성공이 없거나 10분이 지났을 때만 묶음을 다시 읽는다.
 *
 * <p>실행 잠금은 실패 시 다음 틱에서 재시도할 수 있도록 최소 10초만 유지한다. 성공한 경우에는 파드 간 재색인 시작 간격이 10분이 되도록 잠금 최소 유지 시간을
 * 10분으로 연장한다. 테스트에서는 scheduling.enabled=false라 돌지 않는다(SchedulingConfig).
 */
@Slf4j
@Component
public class HelpIndexScheduler {

  /** 성공 뒤 다시 읽기까지의 간격. */
  static final Duration INTERVAL = Duration.ofMinutes(10);

  /** 도움말 묶음 조회·임베딩을 감싸는 ShedLock 이름. */
  private static final String LOCK_NAME = "HelpIndexScheduler.refresh";

  /** 색인 실행이 끝나기 전에 파드가 종료됐을 때 잠금이 풀릴 최대 시간. */
  private static final Duration LOCK_AT_MOST = Duration.ofMinutes(30);

  private final HelpManualIndexer indexer;
  private final Clock clock;
  private volatile Instant lastSuccess;

  @Autowired
  public HelpIndexScheduler(HelpManualIndexer indexer) {
    this(indexer, Clock.systemUTC());
  }

  /** 테스트용 — 시계 주입. */
  HelpIndexScheduler(HelpManualIndexer indexer, Clock clock) {
    this.indexer = indexer;
    this.clock = clock;
  }

  /** 스케줄 진입점 — 간격이 안 지났으면 건너뛴다. */
  @Scheduled(fixedDelay = 60_000, initialDelay = 30_000)
  @SchedulerLock(name = LOCK_NAME, lockAtMostFor = "PT30M", lockAtLeastFor = "PT10S")
  public void refresh() {
    Instant now = clock.instant();
    Instant last = lastSuccess;
    if (last != null && Duration.between(last, now).compareTo(INTERVAL) < 0) return;
    if (!indexer.refresh()) return;

    extendSuccessfulRunLock(now);
    lastSuccess = now;
  }

  /** 성공이 10분 안에 끝났을 때만 파드 간 재색인 간격을 잠금으로 보장한다. */
  private void extendSuccessfulRunLock(Instant startedAt) {
    if (Duration.between(startedAt, clock.instant()).compareTo(INTERVAL) >= 0) return;
    try {
      LockExtender.extendActiveLock(LOCK_AT_MOST, INTERVAL);
    } catch (LockExtender.NoActiveLockException e) {
      // 잠금 비활성 설정에서는 파드별 lastSuccess만 적용한다.
      log.debug("ShedLock이 비활성이라 파드 간 재색인 간격은 적용하지 않는다");
    }
  }
}
