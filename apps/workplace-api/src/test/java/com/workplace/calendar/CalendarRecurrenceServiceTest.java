package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 반복 일정 회차 전개 + 취소 회차 스킵 검증. 메서드 롤백 격리. */
@Transactional
class CalendarRecurrenceServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;

  private static final OffsetDateTime BASE = OffsetDateTime.parse("2026-06-10T09:00:00Z");

  /** 테스트용 사용자 삽입 후 ID 반환. */
  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "c_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** RRULE 포함 일정 요청 헬퍼. */
  private CalendarEventRequest recurringReq(String rrule, OffsetDateTime s, OffsetDateTime e) {
    return new CalendarEventRequest("회의", null, s, e, false, null, null, null, rrule);
  }

  /** 제목 지정 편집 요청 헬퍼(클라이언트가 회차 시작을 그대로 echo 하는 상황 모사). */
  private CalendarEventRequest editReq(String title, String rrule, OffsetDateTime s) {
    return new CalendarEventRequest(title, null, s, s.plusHours(1), false, null, null, null, rrule);
  }

  /** 마스터의 예외 행에 저장된 override_event_id 조회(없으면 null). */
  private Long overrideEventId(long masterId) {
    return dsl.select(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID)
        .from(CALENDAR_EVENT_EXCEPTION)
        .where(CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(masterId))
        .fetchOne(CALENDAR_EVENT_EXCEPTION.OVERRIDE_EVENT_ID);
  }

  /** THIS 수정 → 해당 회차만 오버라이드 일정으로 대체되고 나머지 회차는 그대로. */
  @Test
  void updateScopeThis_createsOverride_replacesOnlyThatOccurrence() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    OffsetDateTime occ2 = BASE.plusWeeks(1);

    // 2번째 회차만 제목 변경(THIS). 클라이언트는 회차 시작(occ2)을 그대로 보낸다.
    service.update(u, master.id(), editReq("수정회의", "FREQ=WEEKLY", occ2), EditScope.THIS, occ2);

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));
    assertThat(r).hasSize(4);
    // occ2 슬롯은 오버라이드(단일 일정)로 대체 — 제목 변경, RRULE 없음.
    CalendarEventResponse at2 =
        r.stream()
            .filter(e -> e.startsAt().toInstant().equals(occ2.toInstant()))
            .findFirst()
            .orElseThrow();
    assertThat(at2.title()).isEqualTo("수정회의");
    assertThat(at2.recurrenceRule()).isNull();
    // 첫 회차는 원본 그대로.
    CalendarEventResponse at1 =
        r.stream()
            .filter(e -> e.startsAt().toInstant().equals(BASE.toInstant()))
            .findFirst()
            .orElseThrow();
    assertThat(at1.title()).isEqualTo("회의");
    // 예외 행에 override_event_id 가 연결됨.
    assertThat(overrideEventId(master.id())).isNotNull();
  }

  /** THIS 삭제 → 해당 회차만 취소되고 나머지는 유지. */
  @Test
  void deleteScopeThis_cancelsOnlyThatOccurrence() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    OffsetDateTime occ2 = BASE.plusWeeks(1);

    service.delete(u, master.id(), EditScope.THIS, occ2);

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));
    assertThat(r).hasSize(3);
    assertThat(r).extracting(CalendarEventResponse::startsAt).doesNotContain(occ2);
  }

  /** ALL 삭제 → 마스터·예외·오버라이드 일정까지 모두 제거(가상 회차도 사라짐). */
  @Test
  void deleteScopeAll_removesMasterAndExpansion() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    OffsetDateTime occ2 = BASE.plusWeeks(1);
    // 오버라이드 1건을 만들어 예외+별도 일정 행을 생성해 둔다.
    service.update(u, master.id(), editReq("수정회의", "FREQ=WEEKLY", occ2), EditScope.THIS, occ2);

    service.delete(u, master.id(), EditScope.ALL, null);

    assertThat(service.list(u, BASE.minusDays(1), BASE.plusWeeks(4))).isEmpty();
    // 예외 행과 오버라이드 별도 일정(고아) 모두 정리됨.
    assertThat(
            dsl.fetchCount(
                CALENDAR_EVENT_EXCEPTION, CALENDAR_EVENT_EXCEPTION.EVENT_ID.eq(master.id())))
        .isZero();
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.OWNER_ID.eq(u))).isZero();
  }

  /** THIS_AND_FOLLOWING 수정 → 시리즈가 분리되어 이전 회차는 옛 마스터, 이후 회차는 새 마스터로 반영. */
  @Test
  void updateScopeFollowing_splitsSeries() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    OffsetDateTime occ3 = BASE.plusWeeks(2);

    CalendarEventResponse newMaster =
        service.update(
            u, master.id(), editReq("후속", "FREQ=WEEKLY", occ3), EditScope.THIS_AND_FOLLOWING, occ3);

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));
    assertThat(r).hasSize(4);
    // occ3 이전(BASE, +1w) → 옛 마스터·원제목.
    assertThat(r)
        .filteredOn(e -> e.startsAt().toInstant().isBefore(occ3.toInstant()))
        .hasSize(2)
        .allSatisfy(
            e -> {
              assertThat(e.title()).isEqualTo("회의");
              assertThat(e.masterEventId()).isEqualTo(master.id());
            });
    // occ3 이후(+2w, +3w) → 새 마스터·변경 제목.
    assertThat(r)
        .filteredOn(e -> !e.startsAt().toInstant().isBefore(occ3.toInstant()))
        .hasSize(2)
        .allSatisfy(
            e -> {
              assertThat(e.title()).isEqualTo("후속");
              assertThat(e.masterEventId()).isEqualTo(newMaster.id());
            });
  }

  /** THIS_AND_FOLLOWING 삭제 → 해당 회차 이후가 모두 잘려 이전 회차만 남는다. */
  @Test
  void deleteScopeFollowing_truncatesSeries() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    OffsetDateTime occ3 = BASE.plusWeeks(2);

    service.delete(u, master.id(), EditScope.THIS_AND_FOLLOWING, occ3);

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));
    assertThat(r).hasSize(2);
    assertThat(r)
        .extracting(CalendarEventResponse::startsAt)
        .containsExactly(BASE, BASE.plusWeeks(1));
  }

  /** 반복 일정의 THIS 인데 occurrenceDate 누락 → IllegalArgumentException(전역 핸들러 400). */
  @Test
  void updateScopeThis_withoutOccurrenceDate_rejected() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));

    assertThatThrownBy(
            () ->
                service.update(
                    u, master.id(), editReq("x", "FREQ=WEEKLY", BASE), EditScope.THIS, null))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /**
   * THIS 오버라이드가 있던 분할점에서 FOLLOWING 수정해도 그 슬롯에 중복이 생기지 않는다(잘려나가는 오버라이드 별도 일정까지 삭제 → 고아 ghost 없음).
   */
  @Test
  void updateFollowing_afterThisOverride_noDuplicateAtSplit() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    OffsetDateTime occ3 = BASE.plusWeeks(2);
    // occ3 회차를 THIS 로 단독 수정 → 오버라이드 별도 일정 생성.
    service.update(u, master.id(), editReq("단독수정", "FREQ=WEEKLY", occ3), EditScope.THIS, occ3);
    // 같은 occ3 를 분할점으로 FOLLOWING 수정.
    CalendarEventResponse newMaster =
        service.update(
            u, master.id(), editReq("후속", "FREQ=WEEKLY", occ3), EditScope.THIS_AND_FOLLOWING, occ3);

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));
    assertThat(r).hasSize(4);
    // occ3 슬롯은 정확히 1건(잔존 오버라이드와의 중복 없음)이며 새 마스터의 후속 회차다.
    List<CalendarEventResponse> atOcc3 =
        r.stream().filter(e -> e.startsAt().toInstant().equals(occ3.toInstant())).toList();
    assertThat(atOcc3).hasSize(1);
    assertThat(atOcc3.get(0).title()).isEqualTo("후속");
    assertThat(atOcc3.get(0).masterEventId()).isEqualTo(newMaster.id());
    // 고아 없음: 잘린 옛 마스터 + 새 마스터 = 2건만 존재(오버라이드 별도 일정은 삭제됨).
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.OWNER_ID.eq(u))).isEqualTo(2);
  }

  /** 기존 오버라이드가 있던 회차를 DELETE/THIS 로 취소하면 회차가 사라지고 오버라이드 별도 일정도 고아로 남지 않는다. */
  @Test
  void deleteThis_overExistingOverride_removesOverrideEvent() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    OffsetDateTime occ2 = BASE.plusWeeks(1);
    service.update(u, master.id(), editReq("단독수정", "FREQ=WEEKLY", occ2), EditScope.THIS, occ2);

    service.delete(u, master.id(), EditScope.THIS, occ2);

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));
    assertThat(r).hasSize(3);
    assertThat(r).extracting(CalendarEventResponse::startsAt).doesNotContain(occ2);
    // 고아 없음: 마스터 1건만 존재(오버라이드 별도 일정 삭제됨).
    assertThat(dsl.fetchCount(CALENDAR_EVENT, CALENDAR_EVENT.OWNER_ID.eq(u))).isEqualTo(1);
  }

  @Test
  void list_weeklyMaster_expandsAcrossWeeks() {
    long u = user();
    // 주간 반복 마스터 생성 — BASE 부터 4주.
    service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));

    assertThat(r).hasSize(4);
    assertThat(r).allSatisfy(e -> assertThat(e.recurrenceRule()).isEqualTo("FREQ=WEEKLY"));
    assertThat(r).extracting(CalendarEventResponse::occurrenceDate).doesNotContainNull();
    assertThat(r).extracting(CalendarEventResponse::masterEventId).doesNotContainNull();
  }

  @Test
  void list_recurringWithCancelledOccurrence_skipsIt() {
    long u = user();
    CalendarEventResponse master =
        service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));

    // 2번째 회차(BASE+1주) 를 취소 예외로 직접 삽입.
    OffsetDateTime secondOccurrence = BASE.plusWeeks(1);
    dsl.insertInto(CALENDAR_EVENT_EXCEPTION)
        .set(CALENDAR_EVENT_EXCEPTION.EVENT_ID, master.id())
        .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, secondOccurrence)
        .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, true)
        .execute();

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));

    // 4회 중 취소 1회 제외 → 3회.
    assertThat(r).hasSize(3);
    assertThat(r).extracting(CalendarEventResponse::startsAt).doesNotContain(secondOccurrence);
  }

  /** 쓰기 시점에 잘못된 RRULE 은 거부된다(IllegalArgumentException → 전역 핸들러 400). */
  @Test
  void create_invalidRecurrenceRule_rejected() {
    long u = user();
    assertThatThrownBy(() -> service.create(u, recurringReq("GARBAGE", BASE, BASE.plusHours(1))))
        .isInstanceOf(IllegalArgumentException.class);
  }

  /** DB 레벨로 손상된 RRULE 마스터가 섞여 있어도 list() 는 500 없이 정상 이벤트만 반환한다(per-master 격리). */
  @Test
  void list_corruptMasterRule_isolatedAndReturnsValidEvents() {
    long u = user();
    // 정상 주간 마스터.
    service.create(u, recurringReq("FREQ=WEEKLY", BASE, BASE.plusHours(1)));
    // 손상된 규칙을 가진 마스터를 DB 에 직접 삽입(쓰기 검증 우회).
    dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, u)
        .set(CALENDAR_EVENT.TITLE, "손상")
        .set(CALENDAR_EVENT.STARTS_AT, BASE)
        .set(CALENDAR_EVENT.ENDS_AT, BASE.plusHours(1))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.RECURRENCE_RULE, "GARBAGE")
        .execute();

    List<CalendarEventResponse> r = service.list(u, BASE.minusDays(1), BASE.plusWeeks(4));

    // 손상 마스터는 스킵, 정상 주간 마스터 4회만 반환.
    assertThat(r).hasSize(4);
    assertThat(r).allSatisfy(e -> assertThat(e.recurrenceRule()).isEqualTo("FREQ=WEEKLY"));
  }
}
