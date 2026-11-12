package com.workplace.help.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.help.repository.HelpMetricRepository;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 도움말 측정(help_metric_daily) 보존 정리(WP-1512) — KST 오늘 기준 {@link #RETENTION_DAYS} 일을 넘긴 행을 지운다(경계일은
 * 남김).
 *
 * <p>테이블이 테넌트 RLS 라 {@link TenantScopedRunner} 로 활성 테넌트마다 GUC 가 주입된 트랜잭션에서 지운다. 정지 테넌트는 다른 테넌트 작업과
 * 같이 건너뛰며, 그 행은 테넌트 purge 가 어차피 제거한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class HelpMetricRetentionScheduler {
  /** 보존 일수. */
  static final int RETENTION_DAYS = 180;

  private final TenantScopedRunner tenantRunner;
  private final HelpMetricRepository repo;

  /** 기동 5분 뒤 첫 실행, 이후 직전 실행 종료 24시간 뒤(행이 일 단위라 하루 한 번이면 충분하다). 한 테넌트 실패는 러너가 격리한다. */
  @Scheduled(initialDelay = 300_000, fixedDelay = 86_400_000)
  @SchedulerLock(name = "HelpMetricRetentionScheduler.purge")
  public void purge() {
    AtomicInteger deleted = new AtomicInteger();
    tenantRunner.forEachActiveTenant(t -> deleted.addAndGet(repo.deleteOlderThan(RETENTION_DAYS)));
    if (deleted.get() > 0) {
      log.debug("도움말 측정 {}일 초과 {} 건 삭제", RETENTION_DAYS, deleted.get());
    }
  }
}
