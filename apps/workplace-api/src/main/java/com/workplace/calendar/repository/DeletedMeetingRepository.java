package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_DELETED_MEETING;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * calendar_deleted_meeting jOOQ 접근(WP-1734) — 사용자가 지운 동기화 미팅(iCalUID)을 기억해, 목록의 크로스소스 정리가 같은 미팅의
 * 동료·주최자 사본을 다시 보이지 않게 한다. 테넌트 격리는 RLS(FORCE)가, 사용자 격리는 모든 쿼리의 user_id 조건이 지킨다.
 *
 * <p>보존: 미팅 끝 시각에서 {@link #RETENTION} 이 지난 기억은 같은 사용자가 다음에 동기화 미팅을 지울 때 함께 지운다(지연 정리). 표가 사용자의 삭제
 * 횟수만큼만 자라 작으므로 테넌트를 도는 스케줄러를 따로 두지 않는 가장 단순한 방법을 골랐다. 끝난 직후 바로 지우지 않고 유예를 두는 것은, 지난 주를 넘겨 볼 때 방금
 * 지운 미팅의 남의 사본이 곧바로 되살아나지 않게 하려는 것이다.
 */
@Repository
@RequiredArgsConstructor
public class DeletedMeetingRepository {

  /** 미팅이 끝난 뒤 기억을 남겨 두는 기간 — 이 기간이 지난 기억은 지연 정리 대상이다. */
  static final Duration RETENTION = Duration.ofDays(30);

  private final DSLContext dsl;

  /**
   * 지운 미팅을 기억한다 — (사용자, iCalUID) 가 이미 있으면 끝 시각만 새로 고친다(다시 초대받아 또 지운 경우). 같은 사용자의 보존 기간이 지난 기억도 이때
   * 지운다.
   */
  public void remember(long userId, String icalUid, OffsetDateTime endsAt) {
    dsl.deleteFrom(CALENDAR_DELETED_MEETING)
        .where(CALENDAR_DELETED_MEETING.USER_ID.eq(userId))
        .and(CALENDAR_DELETED_MEETING.ENDS_AT.lt(OffsetDateTime.now().minus(RETENTION)))
        .execute();
    // tenant_id 는 컬럼 기본값(GUC)으로 채워진다 — 충돌 키는 유니크 인덱스와 같은 (tenant_id, user_id, ical_uid).
    dsl.insertInto(CALENDAR_DELETED_MEETING)
        .set(CALENDAR_DELETED_MEETING.USER_ID, userId)
        .set(CALENDAR_DELETED_MEETING.ICAL_UID, icalUid)
        .set(CALENDAR_DELETED_MEETING.ENDS_AT, endsAt)
        .onConflict(
            CALENDAR_DELETED_MEETING.TENANT_ID,
            CALENDAR_DELETED_MEETING.USER_ID,
            CALENDAR_DELETED_MEETING.ICAL_UID)
        .doUpdate()
        .set(CALENDAR_DELETED_MEETING.ENDS_AT, endsAt)
        .execute();
  }

  /**
   * icalUids 가운데 이 사용자가 지운 미팅의 iCalUID — 목록 한 번에 한 쿼리(N+1 방지). 보존 기간이 지났어도 아직 정리되지 않은 기억은 그대로 센다(정리
   * 시점에 따라 보였다 안 보였다 하지 않게 판단은 행의 유무만 본다).
   */
  public Set<String> deletedAmong(long userId, Collection<String> icalUids) {
    if (icalUids.isEmpty()) {
      return Set.of();
    }
    return new HashSet<>(
        dsl.select(CALENDAR_DELETED_MEETING.ICAL_UID)
            .from(CALENDAR_DELETED_MEETING)
            .where(CALENDAR_DELETED_MEETING.USER_ID.eq(userId))
            .and(CALENDAR_DELETED_MEETING.ICAL_UID.in(icalUids))
            .fetch(CALENDAR_DELETED_MEETING.ICAL_UID));
  }
}
