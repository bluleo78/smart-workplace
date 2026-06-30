package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;

import com.workplace.calendar.dto.CalendarResponse;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** calendar 컨테이너 jOOQ 접근. 소유자 스코프 + 테넌트 RLS 는 GUC 로 자동 격리. */
@Repository
@RequiredArgsConstructor
public class CalendarRepository {
  private final DSLContext dsl;

  /** 소유자의 캘린더 목록(position, id 정렬). 비활성 외부 계정의 캘린더는 제외(즉시 hide). */
  public List<CalendarResponse> listByOwner(long ownerId) {
    return dsl.selectFrom(CALENDAR)
        .where(CALENDAR.OWNER_ID.eq(ownerId))
        .and(visibleExternalCondition())
        .orderBy(CALENDAR.POSITION.asc(), CALENDAR.ID.asc())
        .fetch(CalendarRepository::toResponse);
  }

  /**
   * 외부 캘린더 가시성 조건: 로컬 캘린더(external_account_id IS NULL)이거나, 연결된 메일 계정이 활성(disabled_at IS NULL)일 때만
   * 보인다. 계정 soft-delete 시 그 계정의 외부 캘린더를 메일과 동일하게 즉시 숨기기 위함.
   */
  private static Condition visibleExternalCondition() {
    return CALENDAR
        .EXTERNAL_ACCOUNT_ID
        .isNull()
        .or(
            DSL.exists(
                DSL.selectOne()
                    .from(EMAIL_ACCOUNT)
                    .where(EMAIL_ACCOUNT.ID.eq(CALENDAR.EXTERNAL_ACCOUNT_ID))
                    .and(EMAIL_ACCOUNT.DISABLED_AT.isNull())));
  }

  /** 캘린더 생성 — 생성 id 반환. tenant_id 는 GUC DEFAULT 가 채움. */
  public long insert(long ownerId, String name, String color, boolean isDefault, int position) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, ownerId)
        .set(CALENDAR.NAME, name)
        .set(CALENDAR.COLOR, color)
        .set(CALENDAR.IS_DEFAULT, isDefault)
        .set(CALENDAR.POSITION, position)
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  /** 소유자 본인 캘린더 단건. */
  public Optional<CalendarResponse> findByIdForOwner(long ownerId, long id) {
    return dsl.selectFrom(CALENDAR)
        .where(CALENDAR.ID.eq(id))
        .and(CALENDAR.OWNER_ID.eq(ownerId))
        .and(visibleExternalCondition())
        .fetchOptional()
        .map(CalendarRepository::toResponse);
  }

  /** 소유자 id(권한 검증용). */
  public Optional<Long> findOwnerId(long id) {
    return dsl.select(CALENDAR.OWNER_ID)
        .from(CALENDAR)
        .where(CALENDAR.ID.eq(id))
        .fetchOptional(CALENDAR.OWNER_ID);
  }

  /** 기본 캘린더 여부. */
  public boolean isDefault(long id) {
    return Boolean.TRUE.equals(
        dsl.select(CALENDAR.IS_DEFAULT)
            .from(CALENDAR)
            .where(CALENDAR.ID.eq(id))
            .fetchOne(CALENDAR.IS_DEFAULT));
  }

  /** 읽기전용(외부 동기화) 컨테이너 여부. 존재하지 않는 id 는 false 반환. */
  public boolean isReadOnly(long calendarId) {
    return Boolean.TRUE.equals(
        dsl.select(CALENDAR.IS_READ_ONLY)
            .from(CALENDAR)
            .where(CALENDAR.ID.eq(calendarId))
            .fetchOne(CALENDAR.IS_READ_ONLY));
  }

  /** 소유자의 기본 캘린더 id(없으면 empty). */
  public Optional<Long> findDefaultId(long ownerId) {
    return dsl.select(CALENDAR.ID)
        .from(CALENDAR)
        .where(CALENDAR.OWNER_ID.eq(ownerId))
        .and(CALENDAR.IS_DEFAULT.isTrue())
        .fetchOptional(CALENDAR.ID);
  }

  /** name/color/position 부분 갱신(null 은 건너뜀) + updated_at. */
  public void update(long id, String name, String color, Integer position) {
    var step = dsl.update(CALENDAR).set(CALENDAR.UPDATED_AT, OffsetDateTime.now());
    if (name != null) step = step.set(CALENDAR.NAME, name);
    if (color != null) step = step.set(CALENDAR.COLOR, color);
    if (position != null) step = step.set(CALENDAR.POSITION, position);
    step.where(CALENDAR.ID.eq(id)).execute();
  }

  /** 캘린더의 외부 동기화 참조 — external_account_id/external_id/is_read_only. 미존재 시 empty. */
  public record CalendarExternalRef(Long externalAccountId, String externalId, boolean readOnly) {}

  /** 컨테이너의 외부 참조 조회(외부 쓰기 라우팅 판정용). */
  public Optional<CalendarExternalRef> findExternalRef(long calendarId) {
    return dsl.select(CALENDAR.EXTERNAL_ACCOUNT_ID, CALENDAR.EXTERNAL_ID, CALENDAR.IS_READ_ONLY)
        .from(CALENDAR)
        .where(CALENDAR.ID.eq(calendarId))
        .fetchOptional()
        .map(
            r ->
                new CalendarExternalRef(
                    r.get(CALENDAR.EXTERNAL_ACCOUNT_ID),
                    r.get(CALENDAR.EXTERNAL_ID),
                    Boolean.TRUE.equals(r.get(CALENDAR.IS_READ_ONLY))));
  }

  /** 삭제. */
  public void delete(long id) {
    dsl.deleteFrom(CALENDAR).where(CALENDAR.ID.eq(id)).execute();
  }

  /** 소유자 캘린더의 최대 position(없으면 -1 → 신규는 0). */
  public int maxPosition(long ownerId) {
    Integer max =
        dsl.select(org.jooq.impl.DSL.max(CALENDAR.POSITION))
            .from(CALENDAR)
            .where(CALENDAR.OWNER_ID.eq(ownerId))
            .fetchOne(0, Integer.class);
    return max == null ? -1 : max;
  }

  /** 한 캘린더의 모든 일정을 다른 캘린더로 이동(비기본 삭제 시 데이터 보존). */
  public void moveEventsToCalendar(long fromCalendarId, long toCalendarId) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.CALENDAR_ID, toCalendarId)
        .where(CALENDAR_EVENT.CALENDAR_ID.eq(fromCalendarId))
        .execute();
  }

  private static CalendarResponse toResponse(Record r) {
    return new CalendarResponse(
        r.get(CALENDAR.ID),
        r.get(CALENDAR.NAME),
        r.get(CALENDAR.COLOR),
        r.get(CALENDAR.IS_DEFAULT),
        r.get(CALENDAR.POSITION),
        Boolean.TRUE.equals(r.get(CALENDAR.IS_READ_ONLY)));
  }
}
