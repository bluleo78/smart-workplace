package com.workplace.calendar.outbound;

import java.time.Instant;

/**
 * 캘린더 리마인더 도메인 이벤트. CalendarReminderScheduler 가 발화 시점 도달한 리마인더를 발행하고, notify 도메인이 AFTER_COMMIT 에서
 * 받아 인박스 알림 + SSE fanOut 한다. (모듈 경계 = 이벤트 통신 — 표시용 제목/시간은 notify 가 read-time join 으로 해석)
 */
public final class CalendarReminderEvents {
  private CalendarReminderEvents() {}

  /**
   * 리마인더 발화 — 일정 시작 N분 전 도달. notify 가 ownerId 에게 알림 생성, eventId 로 제목/시간을 조인한다.
   *
   * @param eventId 대상 calendar_event id
   * @param ownerId 알림 수신자(일정 소유자)
   */
  public record CalendarReminderDueEvent(long eventId, long ownerId, Instant occurredAt) {}
}
