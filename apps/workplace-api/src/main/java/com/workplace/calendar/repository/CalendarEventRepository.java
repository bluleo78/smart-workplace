package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_TAG;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.EVENT_REMINDER;

import com.workplace.calendar.GraphEventTypes;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.OutlookTagScope;
import com.workplace.jooq.tables.EmailAccount;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** calendar_event jOOQ 접근. 읽기 접근은 owner OR event_attendee 참석자(accessibleBy 술어). */
@Repository
@RequiredArgsConstructor
public class CalendarEventRepository {
  private final DSLContext dsl;

  /**
   * 읽기 접근 술어: owner 이거나 event_attendee 테이블에 참석자 행이 있으면 접근 가능. list(구체/반복마스터)와 단건 조회 세 경로에 공통 적용해
   * 초대받은 사용자도 자신의 일정을 볼 수 있도록 한다(가시성 역전).
   */
  public static Condition accessibleBy(long callerId) {
    return CALENDAR_EVENT
        .OWNER_ID
        .eq(callerId)
        .or(
            DSL.exists(
                DSL.selectOne()
                    .from(EVENT_ATTENDEE)
                    .where(EVENT_ATTENDEE.EVENT_ID.eq(CALENDAR_EVENT.ID))
                    .and(EVENT_ATTENDEE.USER_ID.eq(callerId))));
  }

  /**
   * 외부 캘린더 가시성 조건: 소속 캘린더가 로컬(external_account_id IS NULL)이거나, 연결된 메일 계정이 활성(disabled_at IS NULL)일
   * 때만 보인다. 계정 soft-delete 시 그 계정 캘린더의 일정을 목록(range/반복 마스터)에서 즉시 숨기기 위함. 두 목록 조회에 동일 적용.
   * leftJoin(CALENDAR) 가 선행되어야 한다.
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

  /**
   * 태그 써 넣기에 쓰는 메일 계정의 별칭 테이블(WP-716) — 달력이 이어진 계정이 호출자 것이고 끊기지 않았을 때만 조인에 걸린다. 일정 행마다 상관 서브쿼리를 돌리지
   * 않고 기본키로 한 번 조인한다(계정은 달력당 하나라 행이 늘지 않는다). 쓰기 경로({@code EmailAccountRepository.findByIdAndUser})와
   * 같은 조건이다.
   */
  private static final EmailAccount TAG_ACCOUNT = EMAIL_ACCOUNT.as("tag_account");

  /** {@link #TAG_ACCOUNT} 조인 조건 — CALENDAR 가 조인돼 있어야 한다. leftJoin 의 on 에 쓴다. */
  private static Condition tagAccountJoin(long callerId) {
    return TAG_ACCOUNT
        .ID
        .eq(CALENDAR.EXTERNAL_ACCOUNT_ID)
        .and(TAG_ACCOUNT.USER_ID.eq(callerId))
        .and(TAG_ACCOUNT.DISABLED_AT.isNull());
  }

  /**
   * 호출자가 M365 일정 사본의 태그를 써 넣을 수 있는 자리인가(WP-716) — 응답 {@code tagsEditable} 과 태그 저장의 허용 판정이 함께 쓰는 공통
   * 규칙.
   *
   * <ol>
   *   <li>호출자가 그 일정 사본의 주인 — 초대받아 남의 사본을 보는 사람은 그 사서함에 쓸 수 없다.
   *   <li>읽기 전용 달력(동료가 공유한 읽기 전용 달력·공휴일·생일 — Graph canEdit=false)이 아니다.
   *   <li>연결 계정 자신의 사서함 달력({@code is_own_mailbox}) — 편집 권한으로 공유받은 동료 달력은 일정이 남의 사서함에 있어 {@code
   *       /me/events/{id}} 로 쓸 수 없다.
   * </ol>
   *
   * 여기에 「달력이 이어진 내 활성 메일 계정이 있다」가 더해져야 최종 허용이다 — 응답은 {@link #TAG_ACCOUNT} 조인으로, 저장 경로는 계정을 직접 읽어 같은
   * 조건을 확인한다. CALENDAR 가 조인돼 있어야 한다.
   */
  private static Condition ownWritableCopy(long callerId) {
    return CALENDAR_EVENT
        .OWNER_ID
        .eq(callerId)
        .and(CALENDAR.IS_READ_ONLY.isFalse())
        .and(CALENDAR.IS_OWN_MAILBOX.isTrue());
  }

  /**
   * 응답 행에 싣는 태그 편집 가능 열(별칭 tags_editable) — 앱 일정(external_id 없음)은 늘 된다. M365 일정은 {@link
   * #ownWritableCopy} 이고 내 활성 메일 계정이 이어져 있어야 한다. CALENDAR 와 {@link #TAG_ACCOUNT}(leftJoin, {@link
   * #tagAccountJoin}) 가 조인돼 있어야 한다.
   */
  private static org.jooq.Field<Boolean> tagsEditable(long callerId) {
    return DSL.field(
            CALENDAR_EVENT
                .EXTERNAL_ID
                .isNull()
                .or(ownWritableCopy(callerId).and(TAG_ACCOUNT.ID.isNotNull())))
        .as("tags_editable");
  }

  /** 일정 생성 — calendarId resolve 완료 후 호출. 생성된 id 반환. */
  public long insert(long ownerId, long calendarId, CalendarEventRequest req) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.TITLE, req.title())
        .set(CALENDAR_EVENT.DESCRIPTION, nullIfBlank(req.description()))
        .set(CALENDAR_EVENT.STARTS_AT, req.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, req.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, req.allDay())
        .set(CALENDAR_EVENT.LOCATION, nullIfBlank(req.location()))
        .set(CALENDAR_EVENT.COLOR, nullIfBlank(req.color()))
        .set(CALENDAR_EVENT.RECURRENCE_RULE, nullIfBlank(req.recurrenceRule()))
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * external_id 동반 일정 생성 — write-through 생성 일정이 born-with-external_id 로 prune(읽기 동기화)에서 보호되도록 한다.
   * insert() 와 동일하되 EXTERNAL_ID 를 세팅한다.
   */
  public long insertWithExternalId(
      long ownerId, long calendarId, CalendarEventRequest req, String externalId) {
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.EXTERNAL_ID, externalId)
        .set(CALENDAR_EVENT.TITLE, req.title())
        .set(CALENDAR_EVENT.DESCRIPTION, nullIfBlank(req.description()))
        .set(CALENDAR_EVENT.STARTS_AT, req.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, req.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, req.allDay())
        .set(CALENDAR_EVENT.LOCATION, nullIfBlank(req.location()))
        .set(CALENDAR_EVENT.COLOR, nullIfBlank(req.color()))
        .set(CALENDAR_EVENT.RECURRENCE_RULE, nullIfBlank(req.recurrenceRule()))
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 일정의 외부 동기화 참조 — 일정 external_id + 소속 캘린더의 external_account_id/is_read_only. onlineMeetingUrl 은
   * 동기화로 저장된 온라인 회의 참가 주소(WP-710, 없으면 null) — 단건 상세의 회의 판정이 같은 행을 한 번 더 읽지 않게 함께 싣는다.
   */
  public record ExternalEventRef(
      String eventExternalId,
      Long externalAccountId,
      boolean calendarReadOnly,
      String onlineMeetingUrl) {}

  /** 일정→캘린더 join 으로 외부 참조 조회. 일정 미존재 시 empty. */
  public Optional<ExternalEventRef> findExternalRef(long eventId) {
    return dsl.select(
            CALENDAR_EVENT.EXTERNAL_ID,
            CALENDAR.EXTERNAL_ACCOUNT_ID,
            CALENDAR.IS_READ_ONLY,
            CALENDAR_EVENT.ONLINE_MEETING_URL)
        .from(CALENDAR_EVENT)
        .join(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .fetchOptional()
        .map(
            r ->
                new ExternalEventRef(
                    r.get(CALENDAR_EVENT.EXTERNAL_ID),
                    r.get(CALENDAR.EXTERNAL_ACCOUNT_ID),
                    Boolean.TRUE.equals(r.get(CALENDAR.IS_READ_ONLY)),
                    r.get(CALENDAR_EVENT.ONLINE_MEETING_URL)));
  }

  /**
   * 태그 저장 대상(WP-716) — 호출자가 볼 수 있는 일정의 외부 참조와 써 넣을 수 있는 자리인지. 써 넣을 Graph 대상(반복 회의면 시리즈 마스터)은 저장값이
   * 아니라 써 넣기 직전에 Graph 에서 읽은 값으로 정하므로 여기 싣지 않는다.
   *
   * @param calendarId 소속 달력 id — 같은 시리즈의 로컬 회차 행을 찾을 때 쓴다
   * @param externalId Graph 일정 id(앱 일정이면 null)
   * @param externalAccountId 달력이 이어진 메일 계정 id(로컬 달력이면 null) — 활성 여부는 호출자가 계정을 읽으며 함께 확인한다
   * @param ownWritableCopy 호출자 사본·쓸 수 있는 내 사서함 달력인가({@link #ownWritableCopy}) — 계정 조건은 뺀 나머지 규칙
   */
  public record TagWriteTarget(
      long calendarId, String externalId, Long externalAccountId, boolean ownWritableCopy) {}

  /** 호출자가 볼 수 있는(주인·참석자) 일정의 태그 저장 대상. 못 보면 empty(→ 404). */
  public Optional<TagWriteTarget> findTagWriteTarget(long callerId, long eventId) {
    return dsl.select(
            CALENDAR_EVENT.CALENDAR_ID,
            CALENDAR_EVENT.EXTERNAL_ID,
            CALENDAR.EXTERNAL_ACCOUNT_ID,
            DSL.field(ownWritableCopy(callerId)).as("own_writable_copy"))
        .from(CALENDAR_EVENT)
        .join(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .and(accessibleBy(callerId))
        .fetchOptional()
        .map(
            r ->
                new TagWriteTarget(
                    r.get(CALENDAR_EVENT.CALENDAR_ID),
                    r.get(CALENDAR_EVENT.EXTERNAL_ID),
                    r.get(CALENDAR.EXTERNAL_ACCOUNT_ID),
                    Boolean.TRUE.equals(r.get("own_writable_copy", Boolean.class))));
  }

  /**
   * 한 달력에서 같은 Graph 시리즈의 보통 회차(occurrence) 행 id(WP-716) — 시리즈 마스터에 범주를 써 넣으면 Outlook 에서 바뀌어 보이는 행은
   * 이 회차들뿐이다. 따로 고친 회차(exception)는 자기 범주가 있어 마스터를 바꿔도 그대로일 수 있으므로 넣지 않는다(다음 동기화가 원본).
   */
  public List<Long> findSeriesOccurrenceIds(long calendarId, String seriesMasterId) {
    return dsl.select(CALENDAR_EVENT.ID)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.CALENDAR_ID.eq(calendarId))
        .and(CALENDAR_EVENT.SERIES_MASTER_ID.eq(seriesMasterId))
        .and(CALENDAR_EVENT.EXTERNAL_TYPE.eq(GraphEventTypes.OCCURRENCE))
        .fetch(CALENDAR_EVENT.ID);
  }

  /**
   * 앱에서 Outlook 범주를 써 넣은 시각을 남긴다(WP-716) — 이 시각보다 먼저 Graph 를 읽어 둔 동기화가 범주 연결을 옛 값으로 되돌리지 않게 한다. 같은
   * 트랜잭션에서 이어지는 연결 갱신 동안 행 잠금도 잡아, 동시에 도는 동기화의 같은 행 upsert 가 이 트랜잭션이 끝난 뒤에 이어지게 한다.
   *
   * @param writtenAt 앱 서버 시계 — 동기화의 수집 시작 시각과 같은 시계로 비교한다
   */
  public void markCategoriesWritten(Collection<Long> eventIds, OffsetDateTime writtenAt) {
    if (eventIds.isEmpty()) return;
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.CATEGORIES_WRITTEN_AT, writtenAt)
        .where(CALENDAR_EVENT.ID.in(eventIds))
        .execute();
  }

  /**
   * 써 넣기 직전에 Graph 에서 읽은 시리즈 마스터 id·일정 종류를 누른 행에 저장한다(WP-716) — 이 컬럼이 생기기 전에 동기화된 행도 다음 동기화를 기다리지
   * 않고 바로 맞춘다.
   */
  public void updateExternalSeries(long eventId, String seriesMasterId, String externalType) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.SERIES_MASTER_ID, seriesMasterId)
        .set(CALENDAR_EVENT.EXTERNAL_TYPE, externalType)
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .execute();
  }

  /** 단일 일정의 소속 캘린더 변경(수정 시 캘린더 이동). */
  public void moveSingleEventToCalendar(long id, long calendarId) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }

  /**
   * 단건 조회 — callerId 가 owner 이거나 참석자인 경우에만 반환(없으면 Optional.empty → service 가 404 처리).
   * event_reminder 를 left join 해 reminderMinutes 포함.
   */
  public Optional<CalendarEventResponse> findById(long callerId, long id) {
    return dsl.select(
            CALENDAR_EVENT.asterisk(),
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR.NAME.as("cal_name"),
            CALENDAR.COLOR.as("cal_color"),
            tagsEditable(callerId))
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .leftJoin(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .leftJoin(TAG_ACCOUNT)
        .on(tagAccountJoin(callerId))
        .where(CALENDAR_EVENT.ID.eq(id))
        .and(accessibleBy(callerId))
        .fetchOptional()
        .map(CalendarEventRepository::toResponse);
  }

  /** 단건 owner 조회 — 권한 검증용. */
  public Optional<Long> findOwnerId(long id) {
    return dsl.select(CALENDAR_EVENT.OWNER_ID)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.ID.eq(id))
        .fetchOptional(CALENDAR_EVENT.OWNER_ID);
  }

  /** 일정이 속한 캘린더의 읽기전용 여부. 존재하지 않는 id 는 false 반환. */
  public boolean isEventCalendarReadOnly(long eventId) {
    return Boolean.TRUE.equals(
        dsl.select(CALENDAR.IS_READ_ONLY)
            .from(CALENDAR_EVENT)
            .join(CALENDAR)
            .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
            .where(CALENDAR_EVENT.ID.eq(eventId))
            .fetchOne(CALENDAR.IS_READ_ONLY));
  }

  /**
   * callerId 가 접근 가능한(owner 또는 참석자) 구체(비반복) 일정 중 [from, to) 와 겹치는 것. 반복 마스터(RRULE 보유)는 회차 전개로 별도
   * 처리하므로 제외. 오버라이드 일정은 RRULE 이 null 이라 여기서 그대로 반환된다.
   */
  public List<CalendarEventResponse> listByRange(
      long callerId, OffsetDateTime from, OffsetDateTime to) {
    return listByRange(callerId, from, to, null);
  }

  /**
   * {@link #listByRange(long, OffsetDateTime, OffsetDateTime)} 를 tagId 태그가 붙은 일정으로 좁힌다(null 이면 전체)
   * — 태그 구독 주소용(WP-715). 조건은 {@link #taggedWith}.
   */
  public List<CalendarEventResponse> listByRange(
      long callerId, OffsetDateTime from, OffsetDateTime to, Long tagId) {
    return dsl.select(
            CALENDAR_EVENT.asterisk(),
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR.NAME.as("cal_name"),
            CALENDAR.COLOR.as("cal_color"),
            tagsEditable(callerId))
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .leftJoin(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .leftJoin(TAG_ACCOUNT)
        .on(tagAccountJoin(callerId))
        .where(accessibleBy(callerId))
        .and(visibleExternalCondition())
        .and(CALENDAR_EVENT.STARTS_AT.lt(to))
        .and(CALENDAR_EVENT.ENDS_AT.gt(from))
        .and(CALENDAR_EVENT.RECURRENCE_RULE.isNull())
        .and(tagId == null ? DSL.noCondition() : taggedWith(tagId))
        .orderBy(CALENDAR_EVENT.STARTS_AT.asc())
        .fetch(CalendarEventRepository::toResponse);
  }

  /**
   * callerId 가 접근 가능한(owner 또는 참석자) 반복 마스터(RRULE 보유) 중 시작이 to 이전인 것. from 하한은 회차 전개(fastForward) 가
   * 처리하므로 두지 않는다(과거에 시작한 마스터의 미래 회차도 잡아야 함).
   */
  public List<CalendarEventResponse> listRecurringMasters(long callerId, OffsetDateTime to) {
    return listRecurringMasters(callerId, to, null);
  }

  /**
   * {@link #listRecurringMasters(long, OffsetDateTime)} 를 tagId 태그가 붙은 마스터로 좁힌다(null 이면 전체) — 태그 구독
   * 주소용(WP-715). 조건은 {@link #taggedWith}.
   */
  public List<CalendarEventResponse> listRecurringMasters(
      long callerId, OffsetDateTime to, Long tagId) {
    return dsl.select(
            CALENDAR_EVENT.asterisk(),
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR.NAME.as("cal_name"),
            CALENDAR.COLOR.as("cal_color"),
            tagsEditable(callerId))
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .leftJoin(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .leftJoin(TAG_ACCOUNT)
        .on(tagAccountJoin(callerId))
        .where(accessibleBy(callerId))
        .and(visibleExternalCondition())
        .and(CALENDAR_EVENT.RECURRENCE_RULE.isNotNull())
        .and(CALENDAR_EVENT.STARTS_AT.lt(to))
        .and(tagId == null ? DSL.noCondition() : taggedWith(tagId))
        .fetch(CalendarEventRepository::toResponse);
  }

  /**
   * 이 일정 행에 tagId 태그가 붙었는가 — 태그 구독 주소(WP-715)가 「태그 키」 규칙을 SQL 로 거는 한 곳. 목록 응답의 태그 채우기({@code
   * CalendarTagService.tagKey})와 같은 규칙이다: 고친 회차(「이 일정만」 오버라이드 행)는 자기 연결이 아니라 마스터의 태그를 따르고, 그 밖의
   * 행(단일 일정·M365 회차 행·반복 마스터)은 자기 연결을 본다. 가상 회차는 마스터를 펼쳐 만들므로 마스터가 이 조건을 통과하면 따라 나온다.
   */
  private static Condition taggedWith(long tagId) {
    Condition isOverride =
        DSL.exists(
            DSL.selectOne()
                .from(CALENDAR_EVENT_EXCEPTION)
                .where(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.eq(CALENDAR_EVENT.ID)));
    Condition ownLinked =
        DSL.exists(
            DSL.selectOne()
                .from(CALENDAR_EVENT_TAG)
                .where(CALENDAR_EVENT_TAG.TAG_ID.eq(tagId))
                .and(CALENDAR_EVENT_TAG.EVENT_ID.eq(CALENDAR_EVENT.ID)));
    Condition masterLinked =
        DSL.exists(
            DSL.selectOne()
                .from(CALENDAR_EVENT_EXCEPTION)
                .join(CALENDAR_EVENT_TAG)
                .on(CALENDAR_EVENT_TAG.EVENT_ID.eq(CALENDAR_EVENT_EXCEPTION.EVENT_ID))
                .where(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.eq(CALENDAR_EVENT.ID))
                .and(CALENDAR_EVENT_TAG.TAG_ID.eq(tagId)));
    return isOverride.not().and(ownLinked).or(masterLinked);
  }

  /** 전체 교체 + updated_at 갱신. */
  public void update(long id, CalendarEventRequest req) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.TITLE, req.title())
        .set(CALENDAR_EVENT.DESCRIPTION, nullIfBlank(req.description()))
        .set(CALENDAR_EVENT.STARTS_AT, req.startsAt())
        .set(CALENDAR_EVENT.ENDS_AT, req.endsAt())
        .set(CALENDAR_EVENT.ALL_DAY, req.allDay())
        .set(CALENDAR_EVENT.LOCATION, nullIfBlank(req.location()))
        .set(CALENDAR_EVENT.COLOR, nullIfBlank(req.color()))
        .set(CALENDAR_EVENT.RECURRENCE_RULE, nullIfBlank(req.recurrenceRule()))
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }

  /** RRULE 만 교체 + updated_at 갱신 — 시리즈 잘라내기(UNTIL 적용)에 사용. */
  public void updateRecurrenceRule(long id, String recurrenceRule) {
    dsl.update(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.RECURRENCE_RULE, nullIfBlank(recurrenceRule))
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .where(CALENDAR_EVENT.ID.eq(id))
        .execute();
  }

  /** 삭제. */
  public void delete(long id) {
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(id)).execute();
  }

  /** 여러 일정 일괄 삭제 — 마스터 삭제 시 고아가 된 오버라이드 일정 정리에 사용. */
  public void deleteAllById(java.util.Collection<Long> ids) {
    if (ids.isEmpty()) {
      return;
    }
    dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.in(ids)).execute();
  }

  private static CalendarEventResponse toResponse(Record r) {
    String override = r.get(CALENDAR_EVENT.COLOR);
    String calColor = r.get("cal_color", String.class); // alias 로 충돌 회피. 조인 없으면 null
    String calName = r.get("cal_name", String.class);
    // 표시용 해석 색: override 우선 → 캘린더 색 → 팔레트 기본('blue'). 항상 non-null.
    String effective = override != null ? override : (calColor != null ? calColor : "blue");
    return new CalendarEventResponse(
        r.get(CALENDAR_EVENT.ID),
        r.get(CALENDAR_EVENT.TITLE),
        r.get(CALENDAR_EVENT.DESCRIPTION),
        r.get(CALENDAR_EVENT.STARTS_AT),
        r.get(CALENDAR_EVENT.ENDS_AT),
        r.get(CALENDAR_EVENT.ALL_DAY),
        r.get(CALENDAR_EVENT.LOCATION),
        override,
        r.get(CALENDAR_EVENT.CALENDAR_ID),
        calName,
        effective,
        r.get(EVENT_REMINDER.LEAD_MINUTES),
        r.get(CALENDAR_EVENT.RECURRENCE_RULE),
        null, // masterEventId — 구체/마스터 행은 회차가 아니므로 null
        null, // occurrenceDate — 가상 회차에서만 채워짐
        r.get(CALENDAR_EVENT.CREATED_AT),
        r.get(CALENDAR_EVENT.UPDATED_AT),
        0, // attendeeCount — 서비스 계층 enrich 전 기본값
        null, // myRsvpStatus — 서비스 계층 enrich 전 기본값
        null, // attendees — 서비스 계층 enrich 전 기본값
        false, // external — 서비스 계층 enrichForGet 에서 채워짐
        null, // myRole — 서비스 계층 enrichForGet 에서 채워짐
        r.get(CALENDAR_EVENT.ICAL_UID), // iCalUid — 동기화 이벤트만 non-null
        null, // onlineMeeting — 서비스 계층 enrichForGet 에서 채워짐(목록마다 최대 1만 자 설명을 정규식으로 훑지 않게 단건 조회에서만)
        List.of(), // tags — 서비스 계층(호출자 기준)에서 채워짐(WP-714)
        // tagsEditable — 앱 일정은 늘, M365 일정은 내 사서함의 쓸 수 있는 달력 사본일 때만(WP-716, tagsEditable)
        Boolean.TRUE.equals(r.get("tags_editable", Boolean.class)),
        outlookTagScope(r.get(CALENDAR_EVENT.EXTERNAL_ID), r.get(CALENDAR_EVENT.SERIES_MASTER_ID)));
  }

  /**
   * M365 일정의 Outlook 범주 단위(WP-716) — 앱 일정은 null, 반복 회의 회차(시리즈 마스터 id 있음)는 시리즈, 그 밖은 이 일정. 화면이 「반복
   * 일정 전체에 붙어요」 안내를 고르는 데 쓴다.
   */
  private static OutlookTagScope outlookTagScope(String externalId, String seriesMasterId) {
    if (externalId == null) return null;
    return seriesMasterId != null ? OutlookTagScope.SERIES : OutlookTagScope.EVENT;
  }

  private static String nullIfBlank(String s) {
    return (s == null || s.isBlank()) ? null : s;
  }
}
