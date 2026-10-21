package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashSet;
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
   * <p>(external_account_id, external_id) 충돌 시 name/color/is_read_only 를 갱신, 신규이면 is_default=false,
   * position=0 으로 INSERT. tenant_id 는 GUC DEFAULT 가 채운다.
   *
   * @param ownerId 달력 소유자 user id
   * @param externalAccountId email_account.id (FK)
   * @param externalId 공급자 측 달력 식별자
   * @param name 달력 이름
   * @param color 달력 색
   * @param readOnly Graph canEdit=false 이면 true (공휴일·생일 달력 등 편집 불가 컨테이너). 재동기화 시 doUpdate 에도 반영해
   *     canEdit 변화를 즉시 반영한다.
   * @param ownMailbox 연결 계정 자신의 사서함 달력인지(Graph owner = 기본 달력의 owner, WP-716). 편집 권한으로 공유받은 동료 달력은
   *     false — 앱 태그를 Outlook 범주로 써 넣지 못한다. 재동기화 때도 갱신한다.
   * @return 컨테이너 calendar.id
   */
  public long upsertExternalCalendar(
      long ownerId,
      long externalAccountId,
      String externalId,
      String name,
      String color,
      boolean readOnly,
      boolean ownMailbox) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, ownerId)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, externalAccountId)
        .set(CALENDAR.EXTERNAL_ID, externalId)
        .set(CALENDAR.NAME, name)
        .set(CALENDAR.COLOR, color)
        .set(CALENDAR.IS_READ_ONLY, readOnly)
        .set(CALENDAR.IS_OWN_MAILBOX, ownMailbox)
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 0)
        // 부분 유니크 인덱스(WHERE external_account_id IS NOT NULL) 기준 충돌
        .onConflict(CALENDAR.EXTERNAL_ACCOUNT_ID, CALENDAR.EXTERNAL_ID)
        .where(CALENDAR.EXTERNAL_ACCOUNT_ID.isNotNull())
        .doUpdate()
        .set(CALENDAR.NAME, name)
        .set(CALENDAR.COLOR, color)
        .set(CALENDAR.IS_READ_ONLY, readOnly) // canEdit 변화 반영 — 배포 후 첫 동기화에서 기존 RO 정정
        .set(CALENDAR.IS_OWN_MAILBOX, ownMailbox) // 배포 후 첫 동기화에서 옛 행(기본 FALSE)을 채운다
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
        .set(CALENDAR_EVENT.ICAL_UID, row.iCalUid())
        .set(CALENDAR_EVENT.ONLINE_MEETING_URL, row.onlineMeetingUrl())
        .set(CALENDAR_EVENT.SERIES_MASTER_ID, row.seriesMasterId())
        .set(CALENDAR_EVENT.EXTERNAL_TYPE, row.externalType())
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
        .set(CALENDAR_EVENT.ICAL_UID, row.iCalUid())
        .set(CALENDAR_EVENT.ONLINE_MEETING_URL, row.onlineMeetingUrl())
        .set(CALENDAR_EVENT.SERIES_MASTER_ID, row.seriesMasterId())
        .set(CALENDAR_EVENT.EXTERNAL_TYPE, row.externalType())
        .set(CALENDAR_EVENT.UPDATED_AT, OffsetDateTime.now())
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 동기 창에서 수신되지 않은 외부 일정 삭제 — 단, 동기화 윈도우 [from, to) 안의 일정만 prune 대상.
   *
   * <p>윈도우 밖(예: 미래로 멀리 떨어진 write-through 생성 일정)은 calendarView 가 가져오지 못해 keep 에 들지 않으므로, 날짜 경계를 두지
   * 않으면 잘못 삭제된다(#502 — #501 stranded 버그의 거울상).
   *
   * @param calendarId 대상 컨테이너 id
   * @param keepExternalIds 유지할 external_id 집합
   * @param from 동기화 윈도우 시작(포함)
   * @param to 동기화 윈도우 끝(배타)
   * @return 삭제된 행 수
   */
  public int pruneEventsNotIn(
      long calendarId, Set<String> keepExternalIds, OffsetDateTime from, OffsetDateTime to) {
    Condition cond =
        CALENDAR_EVENT
            .CALENDAR_ID
            .eq(calendarId)
            .and(CALENDAR_EVENT.EXTERNAL_ID.isNotNull())
            .and(CALENDAR_EVENT.STARTS_AT.ge(from))
            .and(CALENDAR_EVENT.STARTS_AT.lt(to));
    if (!keepExternalIds.isEmpty()) {
      cond = cond.and(CALENDAR_EVENT.EXTERNAL_ID.notIn(keepExternalIds));
    }
    return dsl.deleteFrom(CALENDAR_EVENT).where(cond).execute();
  }

  /**
   * 주어진 일정 중 앱에서 Outlook 범주를 {@code since} 이후에 써 넣은 일정 id(WP-716) — 동기화가 수집을 시작한 뒤 앱이 범주를 써 넣었다면 그
   * 동기화가 가진 범주는 써 넣기 전 값이라, 그 일정의 범주 연결은 건너뛰고 다음 동기화에 맡긴다.
   *
   * @param since 동기화 수집 시작 시각(앱 서버 시계 — 써 넣기 표시와 같은 시계)
   */
  public Set<Long> eventIdsWithCategoriesWrittenAfter(
      Collection<Long> eventIds, OffsetDateTime since) {
    if (eventIds.isEmpty()) return Set.of();
    return new HashSet<>(
        dsl.select(CALENDAR_EVENT.ID)
            .from(CALENDAR_EVENT)
            .where(CALENDAR_EVENT.ID.in(eventIds))
            .and(CALENDAR_EVENT.CATEGORIES_WRITTEN_AT.gt(since))
            .fetch(CALENDAR_EVENT.ID));
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
   *
   * <p>iCalUid: 공급자 표준 미팅 식별자(모든 참석자 사서함 동일값). 순수 로컬 이벤트엔 없어 nullable. 조회 시점 크로스소스 중복 제거 키로 쓰인다.
   *
   * <p>onlineMeetingUrl: Graph onlineMeeting.joinUrl(WP-710). 회의가 아니거나 주소가 없으면 null — 갱신 때도 덮어써 회의가
   * 해제된 일정의 옛 주소가 남지 않게 한다.
   *
   * <p>seriesMasterId·externalType: 반복 회의 회차·예외 회차의 Graph 시리즈 마스터 id 와 Graph 일정 종류(WP-716 —
   * singleInstance | occurrence | exception). 단일 일정의 마스터 id 는 null. 앱에서 시리즈 마스터에 범주를 써 넣은 뒤 Outlook
   * 에서 바뀌어 보이는 같은 시리즈의 occurrence 행만 태그를 함께 바꾸는 데 쓴다.
   */
  public record ExternalEventRow(
      String title,
      String description,
      OffsetDateTime startsAt,
      OffsetDateTime endsAt,
      boolean allDay,
      String location,
      String iCalUid,
      String onlineMeetingUrl,
      String seriesMasterId,
      String externalType) {}
}
