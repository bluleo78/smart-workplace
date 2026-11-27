package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * calendar_event_exception jOOQ 접근. 회차 전개 시 취소/오버라이드된 회차를 건너뛰기 위한 읽기와, 회차 단위 편집/삭제(취소·오버라이드)를 위한
 * 쓰기를 제공한다. 회차 식별 키 occurrence_date 는 timestamptz 이므로 항상 Instant(절대 시각) 로 매칭한다(문자열 비교 금지).
 */
@Repository
@RequiredArgsConstructor
public class CalendarEventExceptionRepository {
  private final DSLContext dsl;

  /**
   * 마스터 event_id 들의 예외 회차 시각을 Instant 집합으로 반환(키=event_id). occurrence_date 는 timestamptz 이므로 문자열이
   * 아닌 epoch-millis(Instant) 로 비교한다. 예외 행이 있으면 취소든 오버라이드든 가상 회차 전개에서 제외 대상이다.
   */
  public Map<Long, Set<Instant>> occurrencesByEvent(Collection<Long> eventIds) {
    Map<Long, Set<Instant>> result = new HashMap<>();
    if (eventIds.isEmpty()) {
      return result;
    }
    dsl.select(CALENDAR_EVENT_EXCEPTION.EVENT_ID, CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.in(eventIds))
        .fetch()
        .forEach(
            r ->
                result
                    .computeIfAbsent(r.get(CALENDAR_EVENT_EXCEPTION.EVENT_ID), k -> new HashSet<>())
                    .add(r.get(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE).toInstant()));
    return result;
  }

  /**
   * 회차 취소 예외 upsert(THIS 삭제). 해당 (event_id, occurrence_date) 회차를 is_cancelled=true 로 기록한다. 이미 예외 행이
   * 있으면(오버라이드였더라도) 취소로 덮어쓰며 override_event_id 는 null 로 비운다. (기존 오버라이드 별도 일정은 서비스가 먼저 삭제해 고아를 방지)
   */
  public void insertCancellation(long eventId, OffsetDateTime occurrenceDate) {
    dsl.insertInto(CALENDAR_EVENT_EXCEPTION)
        .set(CALENDAR_EVENT_EXCEPTION.EVENT_ID, eventId)
        .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, occurrenceDate)
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, true)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, (Long) null)
        .onConflict(CALENDAR_EVENT_EXCEPTION.EVENT_ID, CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .doUpdate()
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, true)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, (Long) null)
        .execute();
  }

  /**
   * 회차 오버라이드 예외 upsert(THIS 수정). 해당 회차를 별도 일정(overrideEventId) 으로 대체하고 취소 플래그는 내린다. 재편집 시 기존 예외 행을
   * override_event_id 만 갱신한다.
   */
  public void upsertOverride(long eventId, OffsetDateTime occurrenceDate, long overrideEventId) {
    dsl.insertInto(CALENDAR_EVENT_EXCEPTION)
        .set(CALENDAR_EVENT_EXCEPTION.EVENT_ID, eventId)
        .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, occurrenceDate)
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, false)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, overrideEventId)
        .onConflict(CALENDAR_EVENT_EXCEPTION.EVENT_ID, CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .doUpdate()
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, false)
        .set(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID, overrideEventId)
        .execute();
  }

  /**
   * 회차의 기존 오버라이드 일정 id 조회(재편집용). 행이 없거나 취소 예외(override_event_id=null) 이면 비어있음 — 둘 다 "재사용할 오버라이드
   * 없음"으로 동일하게 처리한다.
   */
  public Optional<Long> findOverrideEventId(long eventId, OffsetDateTime occurrenceDate) {
    return dsl.select(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
        .and(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE.eq(occurrenceDate))
        .fetchOptional()
        .map(r -> r.get(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID));
  }

  /**
   * 마스터에 예외 행(취소·「이 회차만」 고친 회차)이 하나라도 있는가(WP-2155) — 규칙을 지운 마스터를 Outlook 단일 일정으로 전환할 때, 예외가 남아 있으면
   * 그 회차들이 로컬에만 남아 갈라지므로 반복으로 본다.
   */
  public boolean hasExceptions(long eventId) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CALENDAR_EVENT_EXCEPTION)
            .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId)));
  }

  /** 그 회차가 취소(THIS 삭제)됐는가(WP-1701) — 취소된 회차에는 노트를 잇지 않는다. 예외 행이 없거나 취소가 아니면 false. */
  public boolean isCancelled(long eventId, OffsetDateTime occurrenceDate) {
    return dsl.fetchExists(
        dsl.selectOne()
            .from(CALENDAR_EVENT_EXCEPTION)
            .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
            .and(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE.eq(occurrenceDate))
            .and(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED.isTrue()));
  }

  /** 예외 한 줄(WP-1703) — 회차 원래 시작 시각, 취소 여부, 「이 회차만」 고친 일정 id(취소면 null). */
  public record ExceptionRow(
      long eventId, Instant occurrenceDate, boolean cancelled, Long overrideEventId) {}

  /**
   * 마스터 id 들의 예외 줄을 쿼리 한 번에 (마스터 id → 원래 시작 Instant → 줄) 로 모은다(WP-1703, N+1 금지). 노트에 이어진 회차가
   * 취소됐는지·옮겨졌는지 한꺼번에 가린다. 빈 입력은 쿼리 없이 빈 맵.
   */
  public Map<Long, Map<Instant, ExceptionRow>> findByEvents(Collection<Long> eventIds) {
    Map<Long, Map<Instant, ExceptionRow>> out = new HashMap<>();
    if (eventIds == null || eventIds.isEmpty()) return out;
    dsl.select(
            CALENDAR_EVENT_EXCEPTION.EVENT_ID,
            CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE,
            CALENDAR_EVENT_EXCEPTION.IS_CANCELLED,
            CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.in(eventIds))
        .fetch()
        .forEach(
            r -> {
              ExceptionRow row =
                  new ExceptionRow(
                      r.get(CALENDAR_EVENT_EXCEPTION.EVENT_ID),
                      r.get(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE).toInstant(),
                      Boolean.TRUE.equals(r.get(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED)),
                      r.get(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID));
              out.computeIfAbsent(row.eventId(), k -> new HashMap<>())
                  .put(row.occurrenceDate(), row);
            });
    return out;
  }

  /** override_event_id 역조회 결과 — 마스터 event_id + 해당 회차의 occurrence_date. */
  public record MasterOccurrence(long eventId, OffsetDateTime occurrenceDate) {}

  /**
   * override 별도 일정 자신의 id 로 마스터/회차를 역조회한다(#816). override 이벤트는 자기 행에 masterEventId/occurrenceDate 를
   * 갖지 않으므로(회차 식별은 exception 테이블이 유일한 연결고리), 이 id 를 "독립 삭제" 요청받았을 때 안전하게 마스터 취소로 우회하기 위해 필요하다. 이
   * 조회가 비어있으면 override 가 아닌 일반(비반복) 이벤트다.
   */
  public Optional<MasterOccurrence> findMasterOccurrenceByOverride(long overrideEventId) {
    return dsl.select(CALENDAR_EVENT_EXCEPTION.EVENT_ID, CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.eq(overrideEventId))
        .fetchOptional(
            r ->
                new MasterOccurrence(
                    r.get(CALENDAR_EVENT_EXCEPTION.EVENT_ID),
                    r.get(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)));
  }

  /**
   * 여러 일정 id 중 오버라이드(「이 일정만」 고친 회차) 인 것의 마스터·회차를 한 번에 역조회한다(WP-714·715). 고친 회차는 마스터의 태그를 따르고, 구독
   * 주소는 원래 회차와 같은 UID 를 써야 해서 목록 응답·피드가 배치로 쓴다. 오버라이드가 아닌 id 는 결과에 없다.
   */
  public Map<Long, MasterOccurrence> mastersByOverrides(Collection<Long> eventIds) {
    Map<Long, MasterOccurrence> out = new HashMap<>();
    if (eventIds.isEmpty()) return out;
    dsl.select(
            CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID,
            CALENDAR_EVENT_EXCEPTION.EVENT_ID,
            CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.in(eventIds))
        .fetch()
        .forEach(
            r ->
                out.put(
                    r.get(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID),
                    new MasterOccurrence(
                        r.get(CALENDAR_EVENT_EXCEPTION.EVENT_ID),
                        r.get(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE))));
    return out;
  }

  /** 마스터의 오버라이드 일정 id 목록(ALL 삭제 시 고아 정리용). 마스터 삭제는 override 별도 일정을 cascade 하지 않으므로 서비스가 직접 지운다. */
  public List<Long> overrideEventIds(long eventId) {
    return overrideEventIdsFrom(eventId, null);
  }

  /**
   * occurrence_date 가 cutoff 이상인 예외행들의 not-null override_event_id 목록 — 시리즈 잘라내기(FOLLOWING) 시 잘려나가는
   * 회차의 오버라이드 별도 일정을 고아로 남기지 않도록 함께 삭제하려고 수집한다. cutoff 가 null 이면 마스터 전체 오버라이드를 반환한다.
   */
  public List<Long> overrideEventIdsFrom(long eventId, OffsetDateTime occurrenceDate) {
    var condition =
        CALENDAR_EVENT_EXCEPTION
            .EVENT_ID
            .eq(eventId)
            .and(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID.isNotNull());
    if (occurrenceDate != null) {
      condition = condition.and(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE.ge(occurrenceDate));
    }
    return dsl.select(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(condition)
        .fetch(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID);
  }

  /**
   * occurrence_date 가 cutoff 이상인 예외 행 삭제(THIS_AND_FOLLOWING). 시리즈를 자른 뒤 더 이상 의미 없는 미래 예외(취소/오버라이드
   * 행)를 제거한다. 오버라이드였던 별도 일정 자체는 서비스가 overrideEventIdsFrom 으로 수집해 함께 삭제한다.
   */
  public void deleteFromOccurrence(long eventId, OffsetDateTime occurrenceDate) {
    dsl.deleteFrom(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
        .and(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE.ge(occurrenceDate))
        .execute();
  }

  /**
   * 해당 마스터의 모든 예외 행 키(occurrence_date)를 이동량만큼 옮긴다(WP-1927) — 「전체 일정」 끌어 옮기기가 시리즈를 민 만큼 예외 키도 밀리지
   * 않으면 취소했던 회차가 원래 자리에 되살아나고, 오버라이드 일정과 키가 어긋나 원본 회차가 하나 더 생긴다.
   *
   * <p>먼저 대상 행의 옛 키를 읽어 두고, 각 행을 {@code (event_id, occurrence_date) = 옛 키} 조건으로 새 키 하나씩 갱신한다 — 갱신이
   * 행마다 자기 키를 조건으로 삼아 중간에 다른 행이 바뀌어도 빠뜨리지 않는다. delta 가 없으면 쿼리 없이 끝낸다.
   *
   * <p>갱신 순서는 이동 방향과 반대로 잡는다 — {@code (event_id, occurrence_date)} 유니크라서 이동량이 주기의 배수일 때(주간 시리즈 +7일
   * 등) 앞 행을 먼저 옮기면 아직 안 옮긴 뒷 행의 자리에 부딪혀 유니크 위반으로 500 이 나기 때문이다. 뒤에서 앞으로 옮기면 그 자리는 이미 비어 있다.
   */
  public void shiftOccurrenceDates(long eventId, Duration delta) {
    if (delta == null || delta.isZero()) {
      return;
    }
    List<OffsetDateTime> oldKeys =
        dsl.select(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE)
            .from(CALENDAR_EVENT_EXCEPTION)
            .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
            .fetch(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE);
    // 갱신 순서를 이동 방향과 반대로 잡는다 — (event_id, occurrence_date) 유니크라서 이동량이 주기의 배수일 때
    // (예: 주간 시리즈 +7일) 앞 행을 먼저 옮기면 아직 안 옮긴 뒷 행의 자리에 부딪혀 유니크 위반으로 500 이 난다.
    // 뒤에서 앞으로 옮기면 그 자리는 이미 비어 있어 한 방향으로 밀어도 충돌이 없다(WP-1927).
    oldKeys.sort(delta.isNegative() ? Comparator.naturalOrder() : Comparator.reverseOrder());
    for (OffsetDateTime oldKey : oldKeys) {
      dsl.update(CALENDAR_EVENT_EXCEPTION)
          .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, oldKey.plus(delta))
          .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(eventId))
          .and(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE.eq(oldKey))
          .execute();
    }
  }
}
