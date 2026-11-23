package com.workplace.issue.workflow.service;

import com.workplace.global.tenant.TenantScopedRunner;
import com.workplace.issue.service.IssueClock;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 워크플로우 기다림 타이머(WP-1987) 폴러. 매분 활성 테넌트마다 테넌트 컨텍스트만 세우고({@link
 * TenantScopedRunner#forEachActiveTenantWithoutTx}), 트랜잭션은 {@link WorkflowTimerService#runDue} 가 후보
 * 조회와 방문마다 짧게 열어 커밋한다 — node_run·workflow_run 이 RLS 테이블이라 트랜잭션 진입 때 GUC 가 들어가야 보인다.
 *
 * <p>테넌트 전체를 한 트랜잭션({@code forEachActiveTenant})으로 감싸지 않는 이유(WP-1987 리뷰): 감싸면 방문 행 잠금이 테넌트 poll 이
 * 끝날 때까지 남아 사람의 노드 이동을 붙잡고, 알림 SSE 가 커밋 전에 나간다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class WorkflowTimerScheduler {

  private final WorkflowTimerService timerService;
  private final TenantScopedRunner tenantRunner;
  private final IssueClock issueClock;

  /** 매분 폴링 — 다중 인스턴스에서는 ShedLock 으로 한 곳만 돈다. 한 테넌트의 실패는 다음 테넌트를 막지 않는다(러너가 격리). */
  @Scheduled(fixedRate = 60_000)
  @SchedulerLock(name = "WorkflowTimerScheduler.poll", lockAtMostFor = "PT50S")
  public void poll() {
    tenantRunner.forEachActiveTenantWithoutTx(
        tenantId -> {
          int marked = timerService.runDue(issueClock.now());
          if (marked > 0) log.info("[workflow-timer] 테넌트 {} 기다림 알림 {}건", tenantId, marked);
        });
  }
}
