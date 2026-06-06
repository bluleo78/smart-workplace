package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
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
