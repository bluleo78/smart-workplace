package com.workplace.airun.service;

import com.workplace.airun.repository.AiRunRepository;
import com.workplace.global.tenant.TenantScopedRunner;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 보고 없이 멈춘 AI 처리 기록 정리(WP-1827) — RUNNING 인데 기준 시간 넘게 종료 보고가 없는 행을 FAILED(사유 「보고 없음」)로 닫는다.
 *
 * <p>종류마다 걸리는 시간이 달라 긴 종류({@link #LONG_KINDS})는 60분, 나머지는 {@link #DEFAULT_MAX}(30분)를 기준으로 한다. 테이블이
 * 테넌트 RLS 라 {@link TenantScopedRunner} 로 활성 테넌트마다 따로 실행한다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AiRunStaleSweeper {

  /** 오래 걸리는 종류 — 기준 시간은 {@link #LONG_MAX}. */
  static final Set<String> LONG_KINDS =
      Set.of("AI_CHAT", "PROJECT_REPORT", "PERSONAL_REPORT", "RECURRING_RUN");

  /** 긴 종류의 기준 시간. */
  static final Duration LONG_MAX = Duration.ofMinutes(60);

  /** 긴 종류에 속하지 않는 모든 종류의 기준 시간. */
  static final Duration DEFAULT_MAX = Duration.ofMinutes(30);

  private final TenantScopedRunner tenantRunner;
  private final AiRunRepository repo;

  /** 기동 2분 뒤 첫 실행, 이후 직전 실행 종료 5분 뒤. 한 테넌트 실패는 러너가 격리한다. */
  @Scheduled(initialDelay = 120_000, fixedDelay = 300_000)
  @SchedulerLock(name = "AiRunStaleSweeper.sweep")
  public void sweep() {
    OffsetDateTime now = OffsetDateTime.now();
    AtomicInteger failed = new AtomicInteger();
    tenantRunner.forEachActiveTenant(
        t -> {
          // 종류별 기준(긴 종류 60분·나머지 30분)을 한 번의 UPDATE 로 적용한다(상수 상한으로 부분 색인 범위 사용).
          failed.addAndGet(repo.failStaleRunning(LONG_KINDS, LONG_MAX, DEFAULT_MAX, now));
        });
    if (failed.get() > 0) {
      log.info("보고 없는 AI 처리 {} 건을 실패로 닫음", failed.get());
    }
  }
}
