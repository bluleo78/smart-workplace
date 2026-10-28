package com.workplace.mail.outbound;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 메일 초대 → 내 캘린더 반영 계약(WP-986). 메일 도메인이 정의하고 캘린더 도메인이 구현한다.
 *
 * <p>캘린더는 이미 메일(계정·Graph 클라이언트)에 기대므로 메일이 캘린더 서비스를 직접 부르면 순환이 생긴다. 그래서 메일은 이 계약만 알고, 구현은 {@code
 * calendar} 쪽 빈이 맡는다(캘린더 → 메일 방향 유지). 모든 메서드는 호출자의 쓰기 트랜잭션(RLS GUC 주입) 안에서 부른다.
 */
public interface MailInviteCalendarPort {

  /**
   * 초대 일정 값 — 메일의 iCalendar 에서 읽은 것.
   *
   * @param end 끝(없으면 null — 구현이 기본 길이로 채운다)
   * @param attendeeEmails 참석자 이메일(소문자)
   */
  record InviteEventData(
      String uid,
      int sequence,
      String summary,
      OffsetDateTime start,
      OffsetDateTime end,
      boolean allDay,
      String location,
      String organizerEmail,
      String organizerName,
      List<String> attendeeEmails) {}

  /**
   * 내 캘린더에 있는 같은 UID 일정.
   *
   * @param myResponse 그 일정의 내 응답(참석자 행이 없으면 null)
   * @param sequence 메일 초대로 넣은 일정의 SEQUENCE(동기화 일정은 null)
   * @param cancelled 주최자가 취소한 일정인가
   * @param local 메일 초대로 넣은 앱 일정인가(아니면 M365 동기화 사본)
   * @param organizerEmail 앱 일정의 주최자(외부 ORGANIZER 행) 이메일 — 동기화 사본이거나 없으면 null
   */
  record MyInviteEvent(
      long eventId,
      String myResponse,
      Integer sequence,
      boolean cancelled,
      boolean local,
      String organizerEmail) {}

  /** 내가 주인인 같은 UID 일정 — 메일 초대로 넣은 앱 일정을 동기화 사본보다 먼저 고른다. 없으면 빈 값. */
  Optional<MyInviteEvent> findMyEvent(long userId, String uid);

  /**
   * IMAP 계정 응답의 캘린더 반영 — 수락·미정은 기본 캘린더에 일정을 넣거나(같은 UID 가 있으면 고친다) 내 응답을 바꾸고, 거절은 새로 넣지 않고 있으면 내 응답만
   * DECLINED 로 바꾼다. 같은 UID 앱 일정은 사용자당 하나(V229 유일 인덱스)라 동시에 수락해도 하나만 생긴다. 주최자가 다른 같은 UID 일정이나 이 초대
   * SEQUENCE 이상으로 취소된 일정은 고치지 않는다.
   *
   * @return 반영된 일정 id(거절이고 일정이 없으면 빈 값)
   */
  Optional<Long> applyLocalResponse(
      long userId, String myEmail, InviteEventData event, String response);

  /** M365 계정 응답의 캘린더 반영 — 동기화된 같은 UID 일정의 내 응답을 즉시 바꾼다(다음 동기화 전에도 화면이 맞게). 바꾼 일정 수. */
  int applySyncedResponse(long userId, String uid, String response);

  /**
   * 취소 메일 반영 — 메일 초대로 넣은 같은 UID 앱 일정을 취소로 표시한다. 그 일정의 SEQUENCE 보다 옛 취소, 그 일정의 주최자(ORGANIZER)와 다른
   * 주소가 보낸 취소(위조)는 무시한다.
   *
   * @param organizerEmail 취소 메일 iCalendar 의 ORGANIZER 이메일 — 일정의 주최자와 대소문자 무시로 같아야 반영한다
   * @return 바꾼 일정 수
   */
  int cancelLocal(long userId, String uid, int sequence, String organizerEmail);
}
