package com.workplace.airun.service;

import com.workplace.airun.repository.AiRunRepository;
import com.workplace.global.tenant.TenantScopedRunner;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** AI 처리 기록(ai_run) 보존 정리(WP-1827) — 시작 후 {@link #RETENTION_DAYS} 일을 넘긴 행을 테넌트마다 지운다. */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiRunRetentionScheduler {

  /** 보존 일수. */
  static final int RETENTION_DAYS = 90;

  private final TenantScopedRunner tenantRunner;
  private final AiRunRepository repo;

  /** 기동 5분 뒤 첫 실행, 이후 직전 실행 종료 24시간 뒤. */
  @Scheduled(initialDelay = 300_000, fixedDelay = 86_400_000)
  @SchedulerLock(name = "AiRunRetentionScheduler.purge")
  public void purge() {
    AtomicInteger deleted = new AtomicInteger();
    tenantRunner.forEachActiveTenant(t -> deleted.addAndGet(repo.deleteOlderThan(RETENTION_DAYS)));
    if (deleted.get() > 0) {
      log.info("AI 처리 기록 {}일 초과 {} 건 삭제", RETENTION_DAYS, deleted.get());
    }
  }
}
