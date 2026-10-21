package com.workplace.calendar.service;

import com.workplace.calendar.GraphEventTypes;
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

  /**
   * 외부 일정의 지금 범주·종류·시리즈 마스터 id 를 읽는다(WP-716) — 범주 써 넣기 직전. 앱이 모르는 범주를 덮지 않고, 써 넣을 대상을 저장값이 아닌 현재
   * 값으로 정하려고 쓴다.
   */
  LiveCategories readCategories(long userId, EmailAccountResponse account, String externalEventId);

  /**
   * 외부 일정의 범주(Outlook 범주)만 교체(WP-716) — 앱 태그 써 넣기. 호출자가 {@link #readCategories} 로 읽은 현재 범주에 바뀐 것만
   * 더하고 뺀 목록을 넘긴다.
   *
   * @param categories 붙일 범주 이름 전체(빈 목록이면 모두 뗀다)
   */
  void updateCategories(
      long userId,
      EmailAccountResponse account,
      String externalEventId,
      java.util.List<String> categories);

  /**
   * 써 넣기 직전에 읽은 외부 일정 상태(WP-716).
   *
   * @param type 공급자 일정 종류 — Graph singleInstance | occurrence | exception | seriesMaster(모르면 null)
   * @param seriesMasterId 반복 회의 회차·예외 회차면 시리즈 마스터 id, 아니면 null
   * @param categories 지금 붙은 범주 이름 그대로(없으면 빈 목록)
   */
  record LiveCategories(String type, String seriesMasterId, java.util.List<String> categories) {

    /**
     * 범주를 쓰면 시리즈 마스터까지 바뀌는가 — 시리즈 마스터 id 가 있는 보통 회차(occurrence)·고친 회차(exception). 저장된 시리즈 마스터 id 는
     * 이 컬럼 전에 동기화된 행이면 비어 있으므로, 써 넣기 직전에 읽은 이 값으로 정한다.
     */
    public boolean writesSeries() {
      return seriesMasterId != null
          && (GraphEventTypes.OCCURRENCE.equals(type) || GraphEventTypes.EXCEPTION.equals(type));
    }

    /**
     * 범주를 써 넣을 Graph 일정 id 들(clickedId = 누른 일정).
     *
     * <ul>
     *   <li>occurrence(보통 회차) → 시리즈 마스터만. 회차에 쓰면 Graph 가 그 회차를 예외로 떼어 낸다.
     *   <li>exception(따로 고친 회차) → 그 회차 자신과 시리즈 마스터 — 고친 회차는 자기 범주를 따로 가져 마스터만 바꾸면 화면의 그 회차가 그대로다.
     *   <li>singleInstance·seriesMaster·모름 → 자기 자신.
     * </ul>
     */
    public java.util.List<String> targets(String clickedId) {
      if (!writesSeries()) return java.util.List.of(clickedId);
      return GraphEventTypes.OCCURRENCE.equals(type)
          ? java.util.List.of(seriesMasterId)
          : java.util.List.of(clickedId, seriesMasterId);
    }
  }
}
