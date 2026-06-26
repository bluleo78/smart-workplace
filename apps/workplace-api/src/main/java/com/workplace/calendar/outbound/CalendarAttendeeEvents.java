package com.workplace.calendar.outbound;

/**
 * 캘린더 참석자 도메인 이벤트. CalendarEventService 가 커밋 시 발행하고, notify 도메인의 NotificationDispatcher 가
 * AFTER_COMMIT 에서 소비해 인박스 알림 + SSE fan-out 한다.
 *
 * <p>모듈 경계 = 이벤트 통신 — calendar 도메인에서 notify 도메인을 직접 import 하지 않음.
 */
public final class CalendarAttendeeEvents {
  private CalendarAttendeeEvents() {}

  /**
   * 일정 초대 — 새로 초대된 피초대자에게 알림. notify 가 recipientId 에게 CALENDAR_INVITED 알림 생성.
   *
   * @param eventId 대상 calendar_event id
   * @param recipientId 알림 수신자(피초대자) id
   * @param actorId 초대한 주최자 id
   */
  public record CalendarAttendeeInvitedEvent(long eventId, long recipientId, long actorId) {}

  /**
   * RSVP 변경 — 참석자가 응답 상태를 변경했을 때 주최자에게 알림.
   *
   * @param eventId 대상 calendar_event id
   * @param recipientId 알림 수신자(주최자) id
   * @param actorId RSVP 변경한 참석자 id
   */
  public record CalendarRsvpChangedEvent(long eventId, long recipientId, long actorId) {}
}
