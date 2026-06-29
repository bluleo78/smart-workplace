package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.USER;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collection;
import java.util.List;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * event_attendee 테이블 jOOQ 접근. 테넌트 격리는 RLS(FORCE)가 보장. 주최자(ORGANIZER) 포함 참석자 목록 단일 쿼리를 위한 RFC5545 모델
 * 구현.
 */
@Repository
public class EventAttendeeRepository {

  private final DSLContext dsl;

  public EventAttendeeRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 참석자 행 + user 메타(이름/kind) 조인 결과 레코드.
   *
   * <p>내부 사용자: userId non-null, externalEmail null. 외부 참석자: userId null, externalEmail non-null,
   * kind="EXTERNAL".
   */
  public record AttendeeRow(
      long eventId,
      Long userId,
      String username,
      String name,
      String kind,
      Long invitedByUserId,
      String role,
      String rsvpStatus,
      OffsetDateTime invitedAt,
      OffsetDateTime respondedAt,
      String externalEmail) {}

  /**
   * 참석자 1명 삽입(tenant_id는 GUC DEFAULT가 채움). 중복은 무시(ON CONFLICT DO NOTHING). 주최자 자신이 삽입될 때는
   * invitedByUserId=null.
   */
  public void insert(
      long eventId, long userId, Long invitedByUserId, String role, String rsvpStatus) {
    dsl.insertInto(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.EVENT_ID, eventId)
        .set(EVENT_ATTENDEE.USER_ID, userId)
        .set(EVENT_ATTENDEE.INVITED_BY_USER_ID, invitedByUserId)
        .set(EVENT_ATTENDEE.ROLE, role)
        .set(EVENT_ATTENDEE.RSVP_STATUS, rsvpStatus)
        .onConflict(EVENT_ATTENDEE.EVENT_ID, EVENT_ATTENDEE.USER_ID)
        .doNothing()
        .execute();
  }

  /**
   * 외부(우리 user 아님) 참석자 삽입. user_id=NULL, external_email/name 으로 식별. 중복은 무시(ON CONFLICT DO NOTHING —
   * event_attendee_external_uq 부분 인덱스).
   */
  public void insertExternal(
      long eventId, String email, String displayName, String role, String rsvpStatus) {
    dsl.insertInto(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.EVENT_ID, eventId)
        .set(EVENT_ATTENDEE.EXTERNAL_EMAIL, email)
        .set(EVENT_ATTENDEE.EXTERNAL_NAME, displayName)
        .set(EVENT_ATTENDEE.ROLE, role)
        .set(EVENT_ATTENDEE.RSVP_STATUS, rsvpStatus)
        .onDuplicateKeyIgnore()
        .execute();
  }

  /** 단일 이벤트의 참석자 목록 조회. findByEvents 위임으로 코드 중복 제거. */
  public List<AttendeeRow> findByEvent(long eventId) {
    return findByEvents(List.of(eventId));
  }

  /**
   * 배치 조회(event_id IN ...) — list 렌더링 시 N+1 쿼리 회피. ORGANIZER 먼저, 이후 초대 순서대로 정렬.
   *
   * <p>외부 참석자(user_id NULL)를 포함하기 위해 USER 를 LEFT JOIN 으로 변경. 외부 참석자는 username/name/kind 가 null 이므로
   * externalEmail 필드에 email, kind 를 "EXTERNAL" 로 매핑한다.
   */
  public List<AttendeeRow> findByEvents(Collection<Long> eventIds) {
    if (eventIds.isEmpty()) return List.of();
    return dsl.select(
            EVENT_ATTENDEE.EVENT_ID,
            EVENT_ATTENDEE.USER_ID,
            USER.USERNAME,
            USER.NAME,
            USER.KIND,
            EVENT_ATTENDEE.INVITED_BY_USER_ID,
            EVENT_ATTENDEE.ROLE,
            EVENT_ATTENDEE.RSVP_STATUS,
            EVENT_ATTENDEE.INVITED_AT,
            EVENT_ATTENDEE.RESPONDED_AT,
            EVENT_ATTENDEE.EXTERNAL_EMAIL,
            EVENT_ATTENDEE.EXTERNAL_NAME)
        .from(EVENT_ATTENDEE)
        .leftJoin(USER)
        .on(USER.ID.eq(EVENT_ATTENDEE.USER_ID))
        .where(EVENT_ATTENDEE.EVENT_ID.in(eventIds))
        .orderBy(EVENT_ATTENDEE.ROLE.desc(), EVENT_ATTENDEE.INVITED_AT.asc()) // ORGANIZER 먼저
        .fetch(
            r -> {
              // 외부 참석자: user_id IS NULL → kind="EXTERNAL", name=external_name
              boolean isExternal = r.get(EVENT_ATTENDEE.USER_ID) == null;
              return new AttendeeRow(
                  r.get(EVENT_ATTENDEE.EVENT_ID),
                  r.get(EVENT_ATTENDEE.USER_ID),
                  isExternal ? null : r.get(USER.USERNAME),
                  isExternal ? r.get(EVENT_ATTENDEE.EXTERNAL_NAME) : r.get(USER.NAME),
                  isExternal ? "EXTERNAL" : r.get(USER.KIND),
                  r.get(EVENT_ATTENDEE.INVITED_BY_USER_ID),
                  r.get(EVENT_ATTENDEE.ROLE),
                  r.get(EVENT_ATTENDEE.RSVP_STATUS),
                  r.get(EVENT_ATTENDEE.INVITED_AT),
                  r.get(EVENT_ATTENDEE.RESPONDED_AT),
                  r.get(EVENT_ATTENDEE.EXTERNAL_EMAIL));
            });
  }

  /** 이벤트에 특정 사용자가 참석자로 등록되어 있는지 확인. 권한 검사 등에 사용. */
  public boolean existsForUser(long eventId, long userId) {
    return dsl.fetchExists(
        dsl.selectFrom(EVENT_ATTENDEE)
            .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
            .and(EVENT_ATTENDEE.USER_ID.eq(userId)));
  }

  /** RSVP 상태 업데이트 + responded_at 기록. 반환값: 실제 영향 받은 행 수(0=참석자 미존재). */
  public int updateRsvp(long eventId, long userId, String rsvpStatus) {
    return dsl.update(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.RSVP_STATUS, rsvpStatus)
        .set(EVENT_ATTENDEE.RESPONDED_AT, OffsetDateTime.now())
        .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
        .and(EVENT_ATTENDEE.USER_ID.eq(userId))
        .execute();
  }

  /** 이벤트에서 특정 참석자 제거. 반환값: 실제 삭제된 행 수(0=원래 미등록). */
  public int deleteByEventAndUser(long eventId, long userId) {
    return dsl.deleteFrom(EVENT_ATTENDEE)
        .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))
        .and(EVENT_ATTENDEE.USER_ID.eq(userId))
        .execute();
  }

  /** 외부 참석자 RSVP 갱신 — external_email 기준. */
  public int updateRsvpByExternalEmail(long eventId, String externalEmail, String rsvpStatus) {
    return dsl.update(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.RSVP_STATUS, rsvpStatus)
        .set(EVENT_ATTENDEE.RESPONDED_AT, OffsetDateTime.now(ZoneOffset.UTC))
        .where(
            EVENT_ATTENDEE
                .EVENT_ID
                .eq(eventId)
                .and(EVENT_ATTENDEE.EXTERNAL_EMAIL.equalIgnoreCase(externalEmail)))
        .execute();
  }

  /** 해당 이벤트에서 userId 가 ORGANIZER 역할인지 확인. */
  public boolean isOrganizer(long eventId, long userId) {
    return dsl.fetchExists(
        dsl.select(EVENT_ATTENDEE.ID)
            .from(EVENT_ATTENDEE)
            .where(
                EVENT_ATTENDEE
                    .EVENT_ID
                    .eq(eventId)
                    .and(EVENT_ATTENDEE.USER_ID.eq(userId))
                    .and(EVENT_ATTENDEE.ROLE.eq("ORGANIZER"))));
  }

  /** 외부 참석자 삭제 — external_email 기준. */
  public int deleteByEventAndExternalEmail(long eventId, String externalEmail) {
    return dsl.deleteFrom(EVENT_ATTENDEE)
        .where(
            EVENT_ATTENDEE
                .EVENT_ID
                .eq(eventId)
                .and(EVENT_ATTENDEE.EXTERNAL_EMAIL.equalIgnoreCase(externalEmail)))
        .execute();
  }
}
