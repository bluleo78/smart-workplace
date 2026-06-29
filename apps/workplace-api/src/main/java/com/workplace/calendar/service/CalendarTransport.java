package com.workplace.calendar.service;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.outbound.GraphCalendarClient.GraphEventWrite;

/**
 * 공급자별 일정 역동기화 seam. 로컬 일정 변경을 외부 공급자(M365 Graph 등)로 write-through 한다.
 *
 * <p>provider() 를 키로 CalendarEventService 가 디스패치한다. MailTransport 패턴 미러.
 */
public interface CalendarTransport {

  /** 이 전송기가 담당하는 공급자. */
  MailProvider provider();

  /**
   * 외부 캘린더에 일정 생성 → 공급자 측 external_id 반환.
   *
   * @param externalCalendarId 외부 캘린더 컨테이너 식별자(calendar.external_id)
   */
  String createEvent(
      long userId, EmailAccountResponse account, String externalCalendarId, GraphEventWrite body);

  /** 외부 일정 수정. */
  void updateEvent(
      long userId, EmailAccountResponse account, String externalEventId, GraphEventWrite body);

  /** 외부 일정 삭제(404=이미 없음은 성공). */
  void deleteEvent(long userId, EmailAccountResponse account, String externalEventId);

  /** 외부 일정의 참석자 컬렉션만 교체(attendees-only PATCH). */
  void updateAttendees(
      long userId,
      EmailAccountResponse account,
      String externalEventId,
      java.util.List<com.workplace.mail.outbound.GraphCalendarClient.GraphAttendeeWrite> attendees);
}
