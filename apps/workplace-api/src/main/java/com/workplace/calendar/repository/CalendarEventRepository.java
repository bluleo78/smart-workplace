package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_TAG;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.EVENT_REMINDER;
import static com.workplace.jooq.Tables.USER;

import com.workplace.calendar.GraphEventTypes;
import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.OutlookTagScope;
import com.workplace.global.util.LikePatternUtils;
import com.workplace.jooq.tables.CalendarEvent;
import com.workplace.jooq.tables.EmailAccount;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.CaseConditionStep;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.OrderField;
import org.jooq.Record;
import org.jooq.Record1;
import org.jooq.Record2;
import org.jooq.Select;
import org.jooq.Table;
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
    return accessibleBy(DSL.val(callerId));
  }

  /**
   * {@link #accessibleBy(long)} 의 사용자 열 버전 — 바깥 쿼리의 열(예: 태그 주인 calendar_tag.user_id)과 상관 비교한다. 태그
   * 일정 수가 주인이 지금 볼 수 있는 일정만 세게 할 때 쓴다(WP-1173).
   */
  public static Condition accessibleBy(Field<Long> userId) {
    return CALENDAR_EVENT
        .OWNER_ID
        .eq(userId)
        .or(
            DSL.exists(
                DSL.selectOne()
                    .from(EVENT_ATTENDEE)
                    .where(EVENT_ATTENDEE.EVENT_ID.eq(CALENDAR_EVENT.ID))
                    .and(EVENT_ATTENDEE.USER_ID.eq(userId))));
  }

  /**
   * 외부 캘린더 가시성 조건: 소속 캘린더가 로컬(external_account_id IS NULL)이거나, 연결된 메일 계정이 활성(disabled_at IS NULL)일
   * 때만 보인다. 계정 soft-delete 시 그 계정 캘린더의 일정을 목록(range/반복 마스터)에서 즉시 숨기기 위함. 두 목록 조회에 동일 적용.
   * leftJoin(CALENDAR) 가 선행되어야 한다. 태그 일정 수(WP-1173)도 같은 조건으로 센다.
   */
  static Condition visibleExternalCondition() {
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
  private static Field<Boolean> tagsEditable(long callerId) {
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
   * 이 일정 행이 로컬 「이 회차만」 고친 회차 행인가(예외의 OVERRIDE_EVENT_ID 가 가리키는 행) — 태그 키 규칙({@link #taggedWith})과 검색
   * 후보 제외가 같은 판정을 쓰는 한 곳. 바깥 CALENDAR_EVENT 행과 상관 비교한다.
   */
  private static Condition isOverrideRow() {
    return DSL.exists(
        DSL.selectOne()
            .from(CALENDAR_EVENT_EXCEPTION)
            .where(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.eq(CALENDAR_EVENT.ID)));
  }

  /**
   * 이 일정 행에 tagId 태그가 붙었는가 — 태그 구독 주소(WP-715)가 「태그 키」 규칙을 SQL 로 거는 한 곳. 목록 응답의 태그 채우기({@code
   * CalendarTagService.tagKey})와 같은 규칙이다: 고친 회차(「이 일정만」 오버라이드 행)는 자기 연결이 아니라 마스터의 태그를 따르고, 그 밖의
   * 행(단일 일정·M365 회차 행·반복 마스터)은 자기 연결을 본다. 가상 회차는 마스터를 펼쳐 만들므로 마스터가 이 조건을 통과하면 따라 나온다.
   */
  private static Condition taggedWith(long tagId) {
    Condition isOverride = isOverrideRow();
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

  /**
   * 키워드 검색 후보 한 건(WP-1357) — 일정 응답과 어느 필드가 맞았는지.
   *
   * @param matchedField TITLE | LOCATION | ATTENDEE (제목 > 장소 > 참석자 순으로 먼저 맞은 것)
   * @param matchedText 장소 값 또는 맞은 참석자 이름/메일. TITLE 이면 null
   */
  public record CalendarEventSearchRow(
      CalendarEventResponse event, String matchedField, String matchedText) {}

  /**
   * 검색이 보는 참석자 열 — 내부 사용자 이름·메일, 외부 표시 이름·메일(우선순위 순). 맞음 판정·맞은 값 고르기가 모두 이 목록에서 만들어진다. 내부 참석자도 메일
   * 일부로 찾을 수 있게 USER.EMAIL 을 넣는다.
   */
  private static final List<Field<String>> ATTENDEE_TEXT_COLUMNS =
      List.of(USER.NAME, USER.EMAIL, EVENT_ATTENDEE.EXTERNAL_NAME, EVENT_ATTENDEE.EXTERNAL_EMAIL);

  /**
   * 검색 후보에서 고친 회차 행을 거르는 조건 — 로컬 「이 회차만」 고친 회차 행은 <b>그 마스터가 검색어에 맞지 않을 때만</b> 남는다. 마스터가 맞으면 마스터 한
   * 줄이 시리즈를 대표하고, 마스터는 안 맞는데 고친 회차만 맞으면(예: 한 회차만 「고객 데모」로 고침) 그 행이 단일 일정처럼 후보가 된다. 고친 회차가 아닌 행은 늘
   * 통과한다. 바깥 CALENDAR_EVENT 행과 상관 비교하며, 본 쿼리와 series_ranked 가 같은 판정을 쓰는 한 곳이다.
   *
   * @param matchedIds 검색어가 맞는 일정 id 서브쿼리
   */
  private static Condition notOverrideOfMatchedMaster(Select<Record1<Long>> matchedIds) {
    return isOverrideRow()
        .not()
        .or(
            DSL.notExists(
                DSL.selectOne()
                    .from(CALENDAR_EVENT_EXCEPTION)
                    .where(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.eq(CALENDAR_EVENT.ID))
                    .and(CALENDAR_EVENT_EXCEPTION.EVENT_ID.in(matchedIds))));
  }

  /**
   * 「다가오는 것 먼저 → 시작 오름차순 → 지난 것 시작 내림차순」 정렬 키 세 쌍 — 시리즈 대표 회차 고르기(representativeOrder)가 쓴다. 호출자가
   * 마지막에 동률 깨기 키(id)를 덧붙인다.
   */
  private static List<OrderField<?>> upcomingFirstOrder(Condition upcoming) {
    List<OrderField<?>> keys = new ArrayList<>();
    keys.add(DSL.when(upcoming, DSL.inline(0)).otherwise(DSL.inline(1)).asc());
    keys.add(DSL.when(upcoming, CALENDAR_EVENT.STARTS_AT).asc());
    keys.add(CALENDAR_EVENT.STARTS_AT.desc());
    return keys;
  }

  /** 맞은 참석자 열 값 — ATTENDEE_TEXT_COLUMNS 를 우선순위 순으로 보아 먼저 맞은 열, 앞이 다 안 맞으면 마지막 열. */
  private static Field<String> matchedAttendeeColumn(String pattern) {
    List<Field<String>> cols = ATTENDEE_TEXT_COLUMNS;
    CaseConditionStep<String> pick = null;
    for (Field<String> c : cols.subList(0, cols.size() - 1)) {
      Condition hit = c.likeIgnoreCase(pattern, '\\');
      pick = pick == null ? DSL.when(hit, c) : pick.when(hit, c);
    }
    return pick.otherwise(cols.getLast());
  }

  /**
   * 일정 키워드 검색 후보(WP-1357) — 호출자가 볼 수 있는(주인·참석자, 끊기지 않은 외부 계정) 일정 중 제목·장소·참석자(내부 사용자 이름·메일, 외부
   * 이름·메일)에 term 이 대소문자 무시 부분일치하는 것을 최대 limit 건. 반복 마스터도 포함한다(RECURRENCE_RULE 조건 없음 — 시리즈 한 줄로
   * 찾는다). 같은 iCalUID 사본 정리·페이지 나누기는 서비스가 한다. term 은 비어 있지 않아야 한다.
   *
   * <p>「반복 = 시리즈 한 줄」을 상한 전에 SQL 로 맞춘다: 로컬 「이 회차만」 고친 회차 행(예외의 OVERRIDE_EVENT_ID 가 가리키는 행)은 마스터가
   * 검색어에 맞으면 빼고 마스터가 대표하며, 마스터가 안 맞고 고친 회차만 맞을 때만 그 행이 단일 일정처럼 남는다. 검색하는 사람 자신의 참석자 행은 참석자 맞음에서
   * 제외한다(내 이름으로 찾을 때 내가 참석자인 일정이 전부 나오지 않게; 외부 참석자는 user_id 가 null 이라 남는다). M365 동기화 시리즈처럼 회차마다 행이
   * 있고 SERIES_MASTER_ID 를 공유하는 행들은 (달력, 시리즈) 묶음당 한 줄 — 지금 이후(ends_at &gt; now) 가장 이른 회차, 없으면 가장 최근
   * 회차를 남긴다.
   *
   * <p>상한 정렬 세 묶음: ① 끝나지 않은(ends_at &gt; now) 단일 일정을 시작 오름차순, ② 반복 마스터를 시작 내림차순(최근 시리즈 먼저), ③ 지난
   * 단일을 시작 내림차순, 마지막 id 내림차순. 오래전 시작한 반복 시리즈가 다가오는 단일 일정을 상한 밖으로 밀어내지 않게 한다.
   *
   * @param now 「지금」 기준 시각 — 서비스의 다음 회차 판정과 같은 값을 넘긴다
   * @param limit 최대 행 수(서비스는 잘림 여부를 알려고 상한+1 을 넘긴다)
   */
  public List<CalendarEventSearchRow> searchCandidates(
      long callerId, String term, OffsetDateTime now, int limit) {
    String pattern = LikePatternUtils.containsPattern(term);
    Condition titleMatch = CALENDAR_EVENT.TITLE.likeIgnoreCase(pattern, '\\');
    Condition locationMatch = CALENDAR_EVENT.LOCATION.likeIgnoreCase(pattern, '\\');
    // 참석자 행 하나가 맞는 조건 — 내부는 사용자 이름·메일, 외부는 표시 이름·메일(ATTENDEE_TEXT_COLUMNS 중 하나라도). 검색하는 사람 자신의
    // 행(USER_ID = callerId)은 뺀다 — 외부 참석자는 user_id 가 null 이므로 isDistinctFrom 으로 남긴다.
    Condition attendeeRowMatch =
        DSL.or(ATTENDEE_TEXT_COLUMNS.stream().map(c -> c.likeIgnoreCase(pattern, '\\')).toList())
            .and(EVENT_ATTENDEE.USER_ID.isDistinctFrom(callerId));
    // 검색어가 맞는 일정 id — 제목·장소(한 번의 표 읽기)와 참석자 두 갈래로 고른 뒤 합친다. 키워드 열 인덱스(pg_trgm)는 두지 않는다: 일정 표는 행
    // 보안(RLS)이 켜져 있고 ILIKE(texticlike)가 leakproof 가 아니라 테넌트 조건보다 먼저 인덱스 조건으로 쓰일 수 없어서다(EXPLAIN 으로
    // 확인, WP-1357 이슈 챗 결정 — 테넌트 안 전체 읽기로 충분, 느려지면 후속으로 검색 전용 함수). 바깥은 IN 이라 갈래 사이 중복은 어차피
    // 걸러지므로 UNION ALL(정렬·중복 제거 비용 없음). 별칭을 둬 바깥 CALENDAR_EVENT 와 섞이지 않게 한다.
    CalendarEvent m = CALENDAR_EVENT.as("m_event");
    Select<Record1<Long>> matchedIds =
        DSL.select(m.ID)
            .from(m)
            .where(
                m.TITLE.likeIgnoreCase(pattern, '\\').or(m.LOCATION.likeIgnoreCase(pattern, '\\')))
            .unionAll(
                DSL.select(EVENT_ATTENDEE.EVENT_ID)
                    .from(EVENT_ATTENDEE)
                    .leftJoin(USER)
                    .on(USER.ID.eq(EVENT_ATTENDEE.USER_ID))
                    .where(attendeeRowMatch));
    // 고친 회차 행은 마스터가 검색어에 맞을 때만 뺀다 — 마스터가 맞으면 마스터 한 줄이 대표하고, 고친 회차만 맞으면 그 행이 후보로 남는다.
    Condition notOverride = notOverrideOfMatchedMaster(matchedIds);
    // M365 시리즈 대표 회차 — (달력, SERIES_MASTER_ID) 묶음에서 검색어가 맞고 「호출자가 볼 수 있는」 회차 중 지금 이후 가장 이른 것, 없으면 가장
    // 최근 것 하나. 접기는 접근(주인·참석자)·가시성(끊기지 않은 외부 계정)·고친 회차 제외 조건을 건 뒤에 한다 — 회차마다 내가 참석자인지가 다를
    // 때 내게 안 보이는 회차가 대표로 뽑혀 시리즈 전체가 사라지지 않게 한다. 조건
    // 헬퍼(accessibleBy·visibleExternalCondition·notOverride)를
    // 그대로 쓰려고 서브쿼리 안에서도 별칭 없는 CALENDAR_EVENT·CALENDAR 를 쓴다(SQL 은 안쪽 FROM 을 먼저 찾으므로 바깥 행과 섞이지 않는다).
    List<OrderField<?>> representativeOrder = upcomingFirstOrder(CALENDAR_EVENT.ENDS_AT.gt(now));
    representativeOrder.add(CALENDAR_EVENT.ID.asc());
    Field<Integer> rn =
        DSL.rowNumber()
            .over(
                DSL.partitionBy(CALENDAR_EVENT.CALENDAR_ID, CALENDAR_EVENT.SERIES_MASTER_ID)
                    .orderBy(representativeOrder))
            .as("rn");
    Table<Record2<Long, Integer>> ranked =
        DSL.select(CALENDAR_EVENT.ID, rn)
            .from(CALENDAR_EVENT)
            .leftJoin(CALENDAR)
            .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
            .where(CALENDAR_EVENT.SERIES_MASTER_ID.isNotNull())
            .and(CALENDAR_EVENT.ID.in(matchedIds))
            .and(accessibleBy(callerId))
            .and(visibleExternalCondition())
            .and(notOverride)
            .asTable("series_ranked");
    Condition seriesRepresentative =
        CALENDAR_EVENT
            .SERIES_MASTER_ID
            .isNull()
            .or(
                CALENDAR_EVENT.ID.in(
                    DSL.select(ranked.field(CALENDAR_EVENT.ID))
                        .from(ranked)
                        .where(ranked.field(rn).eq(1))));
    // 맞은 필드 — 제목 > 장소 > 참석자 순으로 먼저 맞은 것
    Field<String> matchedFieldExpr =
        DSL.when(titleMatch, DSL.inline("TITLE"))
            .when(locationMatch, DSL.inline("LOCATION"))
            .otherwise(DSL.inline("ATTENDEE"));
    // 제목·장소가 모두 안 맞아 참석자로 맞은 행에서만 서브쿼리를 평가한다(matchedFieldExpr 가 ATTENDEE 일 때 — 장소가 NULL 이어도 같은 판정).
    Field<String> attendeeText =
        DSL.when(
            matchedFieldExpr.eq(DSL.inline("ATTENDEE")),
            DSL.field(
                DSL.select(DSL.min(matchedAttendeeColumn(pattern)))
                    .from(EVENT_ATTENDEE)
                    .leftJoin(USER)
                    .on(USER.ID.eq(EVENT_ATTENDEE.USER_ID))
                    .where(EVENT_ATTENDEE.EVENT_ID.eq(CALENDAR_EVENT.ID))
                    .and(attendeeRowMatch)));
    Field<String> matchedField = matchedFieldExpr.as("matched_field");
    // 상한 정렬 키 — ① 안 끝난 단일(시작 오름차순) ② 반복 마스터(시작 내림차순, 최근 시리즈 먼저) ③ 지난 단일(시작 내림차순) ④ id 내림차순
    Condition upcomingSingle =
        CALENDAR_EVENT.RECURRENCE_RULE.isNull().and(CALENDAR_EVENT.ENDS_AT.gt(now));
    List<OrderField<?>> capOrder = new ArrayList<>();
    capOrder.add(
        DSL.when(upcomingSingle, DSL.inline(0))
            .when(CALENDAR_EVENT.RECURRENCE_RULE.isNotNull(), DSL.inline(1))
            .otherwise(DSL.inline(2))
            .asc());
    capOrder.add(DSL.when(upcomingSingle, CALENDAR_EVENT.STARTS_AT).asc());
    capOrder.add(CALENDAR_EVENT.STARTS_AT.desc());
    capOrder.add(CALENDAR_EVENT.ID.desc());
    return dsl.select(
            CALENDAR_EVENT.asterisk(),
            EVENT_REMINDER.LEAD_MINUTES,
            CALENDAR.NAME.as("cal_name"),
            CALENDAR.COLOR.as("cal_color"),
            tagsEditable(callerId),
            matchedField,
            attendeeText.as("attendee_text"))
        .from(CALENDAR_EVENT)
        .leftJoin(EVENT_REMINDER)
        .on(EVENT_REMINDER.EVENT_ID.eq(CALENDAR_EVENT.ID))
        .leftJoin(CALENDAR)
        .on(CALENDAR.ID.eq(CALENDAR_EVENT.CALENDAR_ID))
        .leftJoin(TAG_ACCOUNT)
        .on(tagAccountJoin(callerId))
        .where(accessibleBy(callerId))
        .and(visibleExternalCondition())
        .and(CALENDAR_EVENT.ID.in(matchedIds))
        .and(notOverride)
        .and(seriesRepresentative)
        .orderBy(capOrder)
        .limit(limit)
        .fetch(
            r -> {
              String field = r.get("matched_field", String.class);
              String text =
                  switch (field) {
                    case "LOCATION" -> r.get(CALENDAR_EVENT.LOCATION);
                    case "ATTENDEE" -> r.get("attendee_text", String.class);
                    default -> null;
                  };
              return new CalendarEventSearchRow(toResponse(r), field, text);
            });
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

  /**
   * 일정 행을 쓰기 잠금(FOR UPDATE)한다 — 같은 일정을 고치거나 지우는 요청을 차례로 세워, 늦은 쪽이 앞선 쪽의 결과(잘린 RRULE 등)를 보고 다시 판단하게
   * 한다(WP-761). 쓰기 tx 안에서만 부른다.
   */
  public void lockForUpdate(long id) {
    dsl.select(CALENDAR_EVENT.ID)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.ID.eq(id))
        .forUpdate()
        .fetch();
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
