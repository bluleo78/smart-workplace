package com.workplace.issue.workflow.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.issue.service.IssueClock;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 워크플로우 기다림 타이머(WP-1987) 폴러. 매분 활성 테넌트마다 테넌트별 트랜잭션({@link TenantScopedRunner})에서 오래 머문 방문에 알림을 보낸다
 * — node_run·workflow_run 이 RLS 테이블이라 GUC 없는 스케줄러 스레드에서 바로 조회하면 0행이다(IssueRecurrenceScheduler 와 같은
 * 구조).
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkflowTimerScheduler {

  private final WorkflowTimerService timerService;
  private final TenantScopedRunner tenantRunner;
  private final IssueClock issueClock;

  /** 매분 폴링 — 다중 인스턴스에서는 ShedLock 으로 한 곳만 돈다. */
  @Scheduled(fixedRate = 60_000)
  @SchedulerLock(name = "WorkflowTimerScheduler.poll", lockAtMostFor = "PT50S")
  public void poll() {
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          int marked = timerService.runDue(issueClock.now());
          if (marked > 0) log.info("[workflow-timer] 테넌트 {} 기다림 알림 {}건", tenantId, marked);
        });
  }
}
