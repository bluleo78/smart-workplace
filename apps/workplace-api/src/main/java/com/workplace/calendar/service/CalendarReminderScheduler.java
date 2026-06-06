package com.workplace.calendar.service;

import com.workplace.calendar.outbound.CalendarReminderEvents.CalendarReminderDueEvent;
import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.calendar.repository.EventReminderRepository.DueReminder;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 캘린더 리마인더 발화 폴러. 매분 발화 시점 도달한 미발화 리마인더를 조회해 도메인 이벤트를 발행하고 fired_at 을 찍는다.
 *
 * <p>{@code @Transactional} 필수 — notify 의 {@code @TransactionalEventListener(AFTER_COMMIT)} 는 트랜잭션
 * 안에서 발행된 이벤트만 받는다. 발행 + fired_at 마킹을 한 트랜잭션으로 묶어, 커밋 후에만 알림이 나가고(롤백 시 미발화), fired_at 으로 중복 발화를
 * 막는다. (best-effort at-most-once: notify 가 실패해도 재발화하지 않음 — 기존 notify 정책과 동일)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class CalendarReminderScheduler {
  private final EventReminderRepository reminderRepo;
  private final ApplicationEventPublisher publisher;

  /** 매분 폴링. */
  @Scheduled(fixedRate = 60_000)
  @Transactional
  public void poll() {
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
