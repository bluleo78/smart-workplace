package com.workplace.agentaccount.usage;

import com.workplace.tenant.repository.TenantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * AI 계정 사용량 주기 조회 스케줄러(WP-1449). interval(기본 10분) 마다 모든 활성 테넌트를 열거해 테넌트별로 {@link
 * AgentAccountUsageCollector#collectTenant} 를 부른다.
 *
 * <p>설계 의도: 조회는 외부 HTTPS 왕복이라 이 진입점을 트랜잭션으로 감싸지 않는다(TenantScopedRunner 는 테넌트 전체를 한 트랜잭션에 싸므로 쓰지
 * 않는다). 테넌트 목록은 RLS 가 없는 tenant 테이블에서 읽고, 테넌트 컨텍스트·짧은 트랜잭션은 수집 서비스가 연다. 파드 간 동시 실행은 ShedLock 으로 막고,
 * 그래도 겹치면 계정 단위 임대가 한쪽만 조회하게 한다. 한 테넌트의 실패는 경고 후 다음 테넌트로.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class AgentAccountUsageScheduler {

  private final TenantRepository tenantRepository;
  private final AgentAccountUsageCollector collector;
  private final AgentAccountUsageProperties props;

  /** 스케줄 진입점 — 이전 회차가 끝난 뒤 interval 마다. 기동 1분 뒤 첫 실행으로 초기화를 기다린다. 꺼져 있으면 아무것도 하지 않는다. */
  @Scheduled(
      fixedDelayString = "${workplace.agent-account.usage.interval:10m}",
      initialDelay = 60_000)
  @SchedulerLock(name = "AgentAccountUsageScheduler.collect")
  public void collect() {
    if (!props.enabled()) return;
    for (Long tenantId : tenantRepository.findActiveTenantIds()) {
      try {
        collector.collectTenant(tenantId);
      } catch (RuntimeException e) {
        // 계정 목록 읽기 실패 등 — 다른 테넌트는 계속 조회한다. 메시지 대신 종류만(평문 방지).
        log.warn("AI 계정 사용량 조회 — 테넌트 {} 건너뜀: {}", tenantId, e.getClass().getSimpleName());
      }
    }
  }
}
