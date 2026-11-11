package com.workplace.help.service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 도움말 색인 주기 실행(WP-1509) — 1분마다 깨어나되 마지막 성공이 없거나 10분이 지났을 때만 묶음을 다시 읽는다. 실패하면 마지막 성공을 갱신하지 않아 다음 틱에
 * 곧 재시도한다. 여러 파드는 ShedLock 으로 한 번만 돈다. 테스트에서는 scheduling.enabled=false 라 돌지 않는다(SchedulingConfig).
 */
@Slf4j
@Component
public class HelpIndexScheduler {

  /** 성공 뒤 다시 읽기까지의 간격. */
  static final Duration INTERVAL = Duration.ofMinutes(10);

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
  @SchedulerLock(name = "HelpIndexScheduler.refresh")
  public void refresh() {
    Instant now = clock.instant();
    Instant last = lastSuccess;
    if (last != null && Duration.between(last, now).compareTo(INTERVAL) < 0) return;
    if (indexer.refresh()) lastSuccess = now;
  }
}
