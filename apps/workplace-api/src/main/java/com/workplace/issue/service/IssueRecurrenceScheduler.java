package com.workplace.issue.service;

import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.global.tenant.TenantScopedRunner;
import java.time.Instant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 반복 AI 작업(WP-989) 회차 폴러. 매분 활성 테넌트마다 테넌트별 트랜잭션({@link TenantScopedRunner})에서 회차 시각이 된 반복을 실행한다 —
 * issue_recurrence 가 RLS 테이블이라 GUC 없는 스케줄러 스레드에서 바로 조회하면 0행이다(CalendarReminderScheduler 와 같은 구조).
 * 회차 이벤트는 그 테넌트 트랜잭션의 커밋 뒤(AFTER_COMMIT) ai-agent 로 나가므로 다음 회차 시각 갱신과 함께 커밋될 때만 발사된다.
 *
 * <p>ai-agent 연동이 꺼져 있으면 아무것도 하지 않는다 — 회차를 보내지 못하는데 다음 회차로 넘기고 작업을 「작업 중」으로 바꾸면 결과가 영영 오지 않는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class IssueRecurrenceScheduler {

  private final IssueRecurrenceService recurrenceService;
  private final TenantScopedRunner tenantRunner;
  private final AiAgentProperties aiAgentProperties;

  /** 매분 폴링 — 활성 테넌트마다 테넌트별 트랜잭션에서 회차를 보낸다. */
  @Scheduled(fixedRate = 60_000)
  @SchedulerLock(name = "IssueRecurrenceScheduler.poll", lockAtMostFor = "PT50S")
  public void poll() {
    if (!aiAgentProperties.enabled()) return;
    tenantRunner.forEachActiveTenant(
        tenantId -> {
          int sent = recurrenceService.runDue(Instant.now());
          if (sent > 0) log.info("[recurrence] 테넌트 {} 반복 회차 {}건 발사", tenantId, sent);
        });
  }
}
