package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * 외부 공급자(M365 Graph 등)에서 동기화된 캘린더 컨테이너·일정의 upsert/prune/reconcile.
 *
 * <p>calendar 및 calendar_event 테이블의 external_id / external_account_id 컬럼(V106)을 이용해 멱등 upsert를
 * 수행한다. 외부 일정은 사용자가 직접 편집하지 않으므로 recurrence_rule · color 를 항상 null 로 저장하고, 컨테이너 색만 적용한다.
 */
@Repository
@RequiredArgsConstructor
public class ExternalCalendarRepository {

  private final DSLContext dsl;

  /**
   * 외부 달력 컨테이너 upsert.
   *
   * <p>(external_account_id, external_id) 충돌 시 name/color 만 갱신, 신규이면 is_read_only=true,
   * is_default=false, position=0 으로 INSERT. tenant_id 는 GUC DEFAULT 가 채운다.
   *
   * @param ownerId 달력 소유자 user id
   * @param externalAccountId email_account.id (FK)
   * @param externalId 공급자 측 달력 식별자
   * @param name 달력 이름
   * @param color 달력 색
   * @return 컨테이너 calendar.id
   */
  public long upsertExternalCalendar(
      long ownerId, long externalAccountId, String externalId, String name, String color) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, ownerId)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, externalAccountId)
        .set(CALENDAR.EXTERNAL_ID, externalId)
        .set(CALENDAR.NAME, name)
        .set(CALENDAR.COLOR, color)
        .set(CALENDAR.IS_READ_ONLY, true)
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 0)
        // 부분 유니크 인덱스(WHERE external_account_id IS NOT NULL) 기준 충돌
        .onConflict(CALENDAR.EXTERNAL_ACCOUNT_ID, CALENDAR.EXTERNAL_ID)
        .where(CALENDAR.EXTERNAL_ACCOUNT_ID.isNotNull())
        .doUpdate()
        .set(CALENDAR.NAME, name)
        .set(CALENDAR.COLOR, color)
        .set(CALENDAR.UPDATED_AT, OffsetDateTime.now())
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 외부 일정 upsert.
   *
   * <p>(calendar_id, external_id) 충돌 시 변경 가능한 필드를 갱신. 신규이면 INSERT. recurrence_rule · color 는 항상
   * null(외부 일정은 펼친 occurrence, 컨테이너 색 상속).
   *
   * @param ownerId 일정 소유자 user id
   * @param calendarId 소속 컨테이너 calendar.id
   * @param externalId 공급자 측 일정 식별자
   * @param row 일정 데이터
   * @return calendar_event.id
   */
  public long upsertExternalEvent(
      long ownerId, long calendarId, String externalId, ExternalEventRow row) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.EXTERNAL_ID, externalId)
        .set(CALENDAR_EVENT.TITLE, row.title())
        .set(CALENDAR_EVENT.DESCRIPTION, row.description())
        .set(CALENDAR_EVENT.STARTS_AT, row.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, row.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, row.allDay())
        .set(CALENDAR_EVENT.LOCATION, row.location())
        // 부분 유니크 인덱스(WHERE external_id IS NOT NULL) 기준 충돌
        .onConflict(CALENDAR_EVENT.CALENDAR_ID, CALENDAR_EVENT.EXTERNAL_ID)
        .where(CALENDAR_EVENT.EXTERNAL_ID.isNotNull())
        .doUpdate()
        .set(CALENDAR_EVENT.TITLE, row.title())
        .set(CALENDAR_EVENT.DESCRIPTION, row.description())
        .set(CALENDAR_EVENT.STARTS_AT, row.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, row.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, row.allDay())
        .set(CALENDAR_EVENT.LOCATION, row.location())
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 동기 창에서 수신되지 않은 외부 일정 삭제.
   *
   * <p>keep 집합에 없는 external_id 를 가진 일정을 삭제한다. keep 가 비어있으면 해당 컨테이너의 모든 외부 일정을 삭제.
   *
   * @param calendarId 대상 컨테이너 id
   * @param keepExternalIds 유지할 external_id 집합
   * @return 삭제된 행 수
   */
  public int pruneEventsNotIn(long calendarId, Set<String> keepExternalIds) {
    Condition cond =
        CALENDAR_EVENT.CALENDAR_ID.eq(calendarId).and(CALENDAR_EVENT.EXTERNAL_ID.isNotNull());
    if (!keepExternalIds.isEmpty()) {
      cond = cond.and(CALENDAR_EVENT.EXTERNAL_ID.notIn(keepExternalIds));
    }
    return dsl.deleteFrom(CALENDAR_EVENT).where(cond).execute();
  }

  /**
   * 계정에 속한 외부 컨테이너 id 목록.
   *
   * <p>공급자 측에서 삭제된 달력을 감지하기 위한 reconcile 용도.
   *
   * @param externalAccountId email_account.id
   * @return calendar.id 목록
   */
  public List<Long> listExternalCalendarIds(long externalAccountId) {
    return dsl.select(CALENDAR.ID)
        .from(CALENDAR)
        .where(CALENDAR.EXTERNAL_ACCOUNT_ID.eq(externalAccountId))
        .fetch(CALENDAR.ID);
  }

  /**
   * 외부 컨테이너 삭제.
   *
   * <p>calendar_event 는 calendar_id FK ON DELETE CASCADE 로 함께 삭제된다.
   *
   * @param calendarId 삭제할 컨테이너 id
   */
  public void deleteExternalCalendar(long calendarId) {
    dsl.deleteFrom(CALENDAR).where(CALENDAR.ID.eq(calendarId)).execute();
  }

  /**
   * 외부 일정 데이터 record.
   *
   * <p>recurrence_rule · color 는 외부 일정에서 사용하지 않으므로 포함하지 않는다.
   */
  public record ExternalEventRow(
      String title,
      String description,
      OffsetDateTime startsAt,
      OffsetDateTime endsAt,
      boolean allDay,
      String location) {}
}
