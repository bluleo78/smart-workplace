package com.workplace.calendar.service;

import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.calendar.repository.EventReminderRepository.DueReminder;
import com.workplace.global.tenant.TenantScopedRunner;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 캘린더 리마인더 발화 폴러. 매분 발화 시점 도달한 미발화 리마인더를 조회해 도메인 이벤트를 발행하고 fired_at 을 찍는다.
 *
 * <p>멀티테넌트 RLS 전환: event_reminder/calendar_event 가 RLS 적용 테이블이 되어, 스케줄러 스레드(요청 밖, GUC 미설정)에서 전역
 * findDue() 를 호출하면 fail-closed 로 0행만 보여 리마인더가 전면 중단된다. 따라서 {@link TenantScopedRunner} 로 활성 테넌트마다 별도
 * 트랜잭션(테넌트별 GUC 주입)을 열어 순회한다. 자기-호출(self-invocation) 프록시 우회 함정을 피하려고 본체는 비-트랜잭션으로 두고, 트랜잭션 경계는
 * Runner 의 TransactionTemplate 이 연다.
 *
 * <p>알림 체인: {@code pollForCurrentTenant} 가 테넌트별 트랜잭션 안에서 돌므로, 발행된 {@code CalendarReminderDueEvent}
 * 의 AFTER_COMMIT(@Async) 핸들러({@code NotificationDispatcher}) 가 그 커밋 시점에 호출되고,
 * TenantContextTaskDecorator 가 잔존 TenantContext 를 notify 워커로 전파 → notification insert 시
 * GUC(tenant_id) 정상 주입(NOT NULL 위반 없음). 발행 + fired_at 마킹을 한 트랜잭션으로 묶어 커밋 후에만 알림이 나가고(롤백 시 미발화),
 * fired_at 으로 중복 발화를 막는다.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CalendarReminderScheduler {
  private final EventReminderRepository reminderRepo;
  private final ApplicationEventPublisher publisher;
  private final TenantScopedRunner tenantRunner;

  /** 매분 폴링 — 활성 테넌트마다 테넌트별 트랜잭션에서 리마인더를 처리한다. */
  @Scheduled(fixedRate = 60_000)
  public void poll() {
    tenantRunner.forEachActiveTenant(tenantId -> pollForCurrentTenant());
  }

  /**
   * 현재 테넌트(Runner 가 설정한 TenantContext + GUC) 범위의 미발화 리마인더를 처리한다. Runner 의 테넌트별 트랜잭션 안에서 실행되므로
   * findDue/markFired 는 RLS 를 통과하고, publishEvent 의 AFTER_COMMIT 알림 핸들러도 같은 트랜잭션 커밋에 엮인다.
   */
  void pollForCurrentTenant() {
    List<DueReminder> due = reminderRepo.findDue();
    if (due.isEmpty()) return;
    Instant now = Instant.now();
    for (DueReminder r : due) {
      publisher.publishEvent(new CalendarReminderDueEvent(r.eventId(), r.ownerId(), now));
    }
    reminderRepo.markFired(due.stream().map(DueReminder::reminderId).toList());
    log.info("[calendar] 리마인더 {}건 발화", due.size());
  }
}
