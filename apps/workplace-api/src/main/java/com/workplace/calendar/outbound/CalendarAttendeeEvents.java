package com.workplace.calendar.outbound;

import java.time.OffsetDateTime;
import java.util.List;

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

  /**
   * 주최자가 일정의 시간·장소를 바꿨거나(canceled=false) 일정을 지웠을 때(canceled=true) 참석자에게 알린다(WP-712). 지운 일정은 행이
   * 사라지므로 알림에 보일 제목·시작 시각을 이벤트에 담아 넘긴다(커밋 뒤 비동기 리스너가 다시 읽을 수 없다).
   *
   * @param eventId 변경된 일정 id. 취소면 null(행이 사라졌거나 반복의 한 회차만 취소돼 가리킬 일정이 없다)
   * @param recipientIds 알릴 내부 참석자(주최자·행위자·AI 제외)
   * @param actorId 바꾼 주최자
   * @param canceled 취소면 true, 시간·장소 변경이면 false
   * @param title 알림에 보일 일정 제목(변경 후, 취소면 지운 일정의 제목)
   * @param startsAt 알림에 보일 시작 시각(변경 후 새 시각, 취소면 원래 시각)
   */
  public record CalendarEventNoticeEvent(
      Long eventId,
      List<Long> recipientIds,
      long actorId,
      boolean canceled,
      String title,
      OffsetDateTime startsAt) {}
}
