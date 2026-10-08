package com.workplace.wiki.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.wiki.repository.WikiBodyHistoryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 노트 AI 병합 기준본 만료 정리(WP-289) — read_at 이 {@link WikiBodyHistoryRepository#TTL} 을 넘긴 행을 지운다(페이지의 현재
 * version 행은 남긴다). 조회가 만료를 직접 판단하므로 정확성과는 무관하고 테이블 크기만 관리한다.
 *
 * <p>테이블이 테넌트 RLS 라 GUC 없이 지우면 0행이 된다 — {@link TenantScopedRunner} 로 테넌트마다 GUC 가 주입된 트랜잭션에서 지운다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WikiBodyHistoryCleanupScheduler {
  private final TenantScopedRunner tenantRunner;
  private final WikiBodyHistoryRepository bodies;

  /** 기동 5분 뒤 첫 실행, 이후 직전 실행 종료 15분 뒤. */
  @Scheduled(initialDelay = 300_000, fixedDelay = 900_000)
  @SchedulerLock(name = "WikiBodyHistoryCleanupScheduler.scheduled")
  public void scheduled() {
    sweepAllTenants();
  }

  /** 활성 테넌트마다 만료 기준본 삭제(테스트 진입점). 한 테넌트 실패는 러너가 격리한다. */
  public void sweepAllTenants() {
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          int deleted = bodies.deleteExpired(WikiBodyHistoryRepository.TTL);
          if (deleted > 0) {
            log.debug("테넌트 {} 만료 기준본 {} 건 삭제", tenantId, deleted);
          }
        });
  }
}
