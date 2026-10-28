package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 메일 초대(iCalendar UID)로 이어지는 일정 읽기·쓰기(WP-986). 일정 CRUD({@link CalendarEventRepository})와 달리
 * UID·SEQUENCE·취소 표시만 다룬다. 모든 메서드는 쓰기 트랜잭션(RLS GUC) 안에서 부른다.
 */
@Repository
@RequiredArgsConstructor
public class CalendarInviteEventRepository {

  private final DSLContext dsl;

  /**
   * 내가 주인인 같은 UID 일정 한 행.
   *
   * @param local 메일 초대로 넣은 앱 일정(external_id 없음 + ical_sequence 있음)인가 — 아니면 M365 동기화 사본 등
   * @param organizerEmail 외부 주최자(ORGANIZER 행의 external_email, 소문자) — 없으면 null
   */
  public record InviteEventRow(
      long id,
      boolean local,
      Integer sequence,
      boolean cancelled,
      String title,
      String myResponse,
      String organizerEmail) {}

  /** 주인이 나인 같은 UID 일정들 — 앱 일정 먼저, 그다음 id 순. 내 응답은 내 참석자 행(없으면 null). */
  public List<InviteEventRow> findOwnedByUid(long ownerId, String uid) {
    var myRsvp =
        DSL.field(
            DSL.select(EVENT_ATTENDEE.RSVP_STATUS)
                .from(EVENT_ATTENDEE)
                .where(EVENT_ATTENDEE.EVENT_ID.eq(CALENDAR_EVENT.ID))
                .and(EVENT_ATTENDEE.USER_ID.eq(ownerId))
                .limit(1));
    // 메일 초대로 넣은 일정의 주최자는 외부 이메일 ORGANIZER 행 — 취소·최신 판정에서 같은 주최자인지 본다
    var organizer =
        DSL.field(
            DSL.select(DSL.lower(EVENT_ATTENDEE.EXTERNAL_EMAIL))
                .from(EVENT_ATTENDEE)
                .where(EVENT_ATTENDEE.EVENT_ID.eq(CALENDAR_EVENT.ID))
                .and(EVENT_ATTENDEE.ROLE.eq("ORGANIZER"))
                .and(EVENT_ATTENDEE.EXTERNAL_EMAIL.isNotNull())
                .limit(1));
    return dsl.select(
            CALENDAR_EVENT.ID,
            CALENDAR_EVENT.EXTERNAL_ID,
            CALENDAR_EVENT.ICAL_SEQUENCE,
            CALENDAR_EVENT.CANCELLED_AT,
            CALENDAR_EVENT.TITLE,
            myRsvp.as("my_rsvp"),
            organizer.as("organizer_email"))
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.OWNER_ID.eq(ownerId))
        .and(CALENDAR_EVENT.ICAL_UID.eq(uid))
        .orderBy(DSL.when(localEvent(), 0).otherwise(1).asc(), CALENDAR_EVENT.ID.asc())
        .fetch(
            r ->
                new InviteEventRow(
                    r.get(CALENDAR_EVENT.ID),
                    r.get(CALENDAR_EVENT.EXTERNAL_ID) == null
                        && r.get(CALENDAR_EVENT.ICAL_SEQUENCE) != null,
                    r.get(CALENDAR_EVENT.ICAL_SEQUENCE),
                    r.get(CALENDAR_EVENT.CANCELLED_AT) != null,
                    r.get(CALENDAR_EVENT.TITLE),
                    r.get("my_rsvp", String.class),
                    r.get("organizer_email", String.class)));
  }

  /** 메일 초대로 넣은 앱 일정 조건 — V229 부분 유일 인덱스의 술어와 같다(ON CONFLICT 가 그 인덱스를 고르려면 같아야 한다). */
  private static Condition localEvent() {
    return CALENDAR_EVENT.EXTERNAL_ID.isNull().and(CALENDAR_EVENT.ICAL_SEQUENCE.isNotNull());
  }

  /** 첫 번째(대표) 일정. */
  public Optional<InviteEventRow> findFirstOwnedByUid(long ownerId, String uid) {
    return findOwnedByUid(ownerId, uid).stream().findFirst();
  }

  /** 초대 일정 값(제목·시간·장소·UID·SEQUENCE). */
  public record InviteEventValues(
      String title,
      OffsetDateTime startsAt,
      OffsetDateTime endsAt,
      boolean allDay,
      String location,
      String uid,
      int sequence) {}

  /**
   * 메일 초대로 앱 일정을 만든다(취소 아님). 같은 주인·UID 앱 일정이 이미 있으면(동시 수락 — V229 유일 인덱스
   * uq_calendar_event_owner_ical_uid_local) 넣지 않고 빈 값 — 호출자가 다시 읽어 고친다.
   *
   * @return 생성 id(이미 있으면 빈 값)
   */
  public Optional<Long> insertIfAbsent(long ownerId, long calendarId, InviteEventValues v) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.TITLE, v.title())
        .set(CALENDAR_EVENT.STARTS_AT, v.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, v.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, v.allDay())
        .set(CALENDAR_EVENT.LOCATION, v.location())
        .set(CALENDAR_EVENT.ICAL_UID, v.uid())
        .set(CALENDAR_EVENT.ICAL_SEQUENCE, v.sequence())
        // 부분 유일 인덱스의 술어와 같아야 ON CONFLICT 가 그 인덱스를 고른다
        .onConflict(CALENDAR_EVENT.OWNER_ID, CALENDAR_EVENT.ICAL_UID)
        .where(localEvent())
        .doNothing()
        .returning(CALENDAR_EVENT.ID)
        .fetchOptional()
        .map(r -> r.getId());
  }

  /** 같은 일정을 새 초대 값으로 고친다 — 다시 초대된 것이므로 취소 표시를 지운다. */
  public void update(long id, InviteEventValues v) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.TITLE, v.title())
        .set(CALENDAR_EVENT.STARTS_AT, v.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, v.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, v.allDay())
        .set(CALENDAR_EVENT.LOCATION, v.location())
        .set(CALENDAR_EVENT.ICAL_SEQUENCE, v.sequence())
        .setNull(CALENDAR_EVENT.CANCELLED_AT)
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }

  /** 취소 표시 — 제목도 바꿔 기존 캘린더 화면에서 보이게 한다(Outlook 의 「Canceled:」 처럼). */
  public void markCancelled(long id, String title, int sequence) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.CANCELLED_AT, OffsetDateTime.now())
        .set(CALENDAR_EVENT.TITLE, title)
        .set(CALENDAR_EVENT.ICAL_SEQUENCE, sequence)
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }
}
