package com.workplace.mail.dto;

import java.time.OffsetDateTime;

/**
 * 메일 상세의 일정 초대 카드(WP-986) — {@code EmailMessageDetail.calendarInvite}. 메일의
 * iCalendar(METHOD:REQUEST·CANCEL)와 내 캘린더 상태를 합쳐 만든다. 판정은 iCalendar 규칙(METHOD/UID/SEQUENCE)만 쓴다.
 *
 * @param method REQUEST(초대) | CANCEL(취소)
 * @param uid iCalendar UID
 * @param sequence iCalendar SEQUENCE
 * @param start 시작(ISO-8601 오프셋). 종일이면 그 날짜의 UTC 자정
 * @param end 끝(배타, 없으면 null)
 * @param organizer 주최자(없으면 null)
 * @param attendeeCount 주최자를 포함한 서로 다른 참석자 수
 * @param myResponse 내 응답 — 내 캘린더의 같은 UID 일정 응답, 없으면 이 메일에서 보낸 응답, 그것도 없으면 NEEDS_ACTION
 * @param eventId 내 캘린더의 같은 UID 일정(「캘린더에서 보기」), 없으면 null
 * @param outdated 같은 UID 의 더 최신 SEQUENCE(다른 메일·넣어 둔 일정)를 알고 있다
 * @param canRespond REQUEST·최신·주최자 이메일 있음·응답 수단 있음(IMAP 은 내가 참석자 목록에 있어야 한다)
 * @param fromOrganizer 이 메일을 주최자가 보냈다(iCalendar ORGANIZER = 메일 From·Sender). false 인 취소 메일은 내 일정을
 *     건드리지 않았다
 * @param unverifiedNewer REQUEST 카드에서 — 주최자가 보내지 않은 같은 UID 의 더 새 초대·취소 메일이 있다. 낡음 판정에는 세지 않아 응답은
 *     그대로 되지만, 카드가 주최자에게 확인하라고 알린다
 */
public record CalendarInvite(
    String method,
    String uid,
    int sequence,
    String summary,
    OffsetDateTime start,
    OffsetDateTime end,
    boolean allDay,
    String location,
    Organizer organizer,
    int attendeeCount,
    String myResponse,
    Long eventId,
    boolean outdated,
    boolean canRespond,
    boolean fromOrganizer,
    boolean unverifiedNewer) {

  /** 주최자. */
  public record Organizer(String name, String email) {}
}
