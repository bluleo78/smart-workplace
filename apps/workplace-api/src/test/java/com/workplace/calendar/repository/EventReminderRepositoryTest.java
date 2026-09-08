package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_REMINDER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.repository.EventReminderRepository.DueReminder;
import com.workplace.calendar.repository.EventReminderRepository.Rearm;
import com.workplace.calendar.service.CalendarService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** EventReminderRepository — upsert/due 판정/rearm(#705 회차별 재무장)/삭제. 메서드 롤백 격리. */
@Transactional
class EventReminderRepositoryTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired EventReminderRepository repo;
  @Autowired CalendarService calendarService;

  private long user() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "er_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U" + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /**
   * ownerId 의 일정 1건 시드(starts_at 지정, 옵션 recurrenceRule) 후 eventId 반환. V104 NOT NULL: calendar_id
   * 필수.
   */
  private long event(long ownerId, OffsetDateTime startsAt, String recurrenceRule) {
    long calId = calendarService.ensureDefault(ownerId);
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.TITLE, "회의")
        .set(CALENDAR_EVENT.STARTS_AT, startsAt)
        .set(CALENDAR_EVENT.ENDS_AT, startsAt.plusHours(1))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.CALENDAR_ID, calId)
        .set(CALENDAR_EVENT.RECURRENCE_RULE, recurrenceRule)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  private long event(long ownerId, OffsetDateTime startsAt) {
    return event(ownerId, startsAt, null);
  }

  private Integer leadOf(long eventId) {
    return dsl.select(EVENT_REMINDER.LEAD_MINUTES)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.LEAD_MINUTES);
  }

  private OffsetDateTime nextFireOf(long eventId) {
    return dsl.select(EVENT_REMINDER.NEXT_FIRE_AT)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.NEXT_FIRE_AT);
  }

  private long reminderId(long eventId) {
    return dsl.select(EVENT_REMINDER.ID)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.ID);
  }

  @Test
  void upsert_isIdempotentPerEvent_replacesLeadAndSchedule() {
    long u = user();
    OffsetDateTime start = OffsetDateTime.now().plusHours(2);
    long e = event(u, start);

    repo.upsert(e, 10, start.minusMinutes(10));
    assertThat(leadOf(e)).isEqualTo(10);
    assertThat(nextFireOf(e)).isEqualTo(start.minusMinutes(10));

    // 같은 이벤트 재설정 → 1건 유지(교체)
    repo.upsert(e, 60, start.minusMinutes(60));
    assertThat(leadOf(e)).isEqualTo(60);
    assertThat(nextFireOf(e)).isEqualTo(start.minusMinutes(60));
    assertThat(dsl.fetchCount(EVENT_REMINDER, EVENT_REMINDER.EVENT_ID.eq(e))).isEqualTo(1);
  }

  @Test
  void findDue_returnsOnlyPastDueUnfired_withOwner() {
    long u = user();
    // 발화 시점 도달(시작 5분 전, 시작이 3분 후 → 이미 due)
    OffsetDateTime dueStart = OffsetDateTime.now().plusMinutes(3);
    long dueEvent = event(u, dueStart);
    repo.upsert(dueEvent, 5, dueStart.minusMinutes(5));
    // 아직 멀었음(시작 2시간 후, 10분 전 리마인더 → 미도달)
    OffsetDateTime futureStart = OffsetDateTime.now().plusHours(2);
    long futureEvent = event(u, futureStart);
    repo.upsert(futureEvent, 10, futureStart.minusMinutes(10));

    List<DueReminder> due = repo.findDue();

    assertThat(due).extracting(DueReminder::eventId).contains(dueEvent).doesNotContain(futureEvent);
    DueReminder d = due.stream().filter(x -> x.eventId() == dueEvent).findFirst().orElseThrow();
    assertThat(d.ownerId()).isEqualTo(u);
    assertThat(d.leadMinutes()).isEqualTo(5);
    assertThat(d.startsAt()).isEqualTo(dueStart);
  }

  @Test
  void findDue_excludesReminderWithNullNextFireAt() {
    long u = user();
    long e = event(u, OffsetDateTime.now().plusMinutes(1));
    // next_fire_at 이 null 이면(단발 완료 등) due 대상에서 제외.
    repo.upsert(e, 10, null);

    assertThat(repo.findDue()).extracting(DueReminder::eventId).doesNotContain(e);
  }

  @Test
  void rearm_singleEvent_clearsNextFireAt() {
    long u = user();
    long e = event(u, OffsetDateTime.now().plusMinutes(1));
    repo.upsert(e, 10, OffsetDateTime.now().minusMinutes(1));
    long rid = reminderId(e);

    repo.rearm(List.of(new Rearm(rid, null)));

    assertThat(nextFireOf(e)).isNull();
    assertThat(repo.findDue()).extracting(DueReminder::eventId).doesNotContain(e);
  }

  @Test
  void rearm_recurringEvent_advancesToNextOccurrence() {
    long u = user();
    OffsetDateTime start = OffsetDateTime.now().minusDays(7);
    long e = event(u, start, "FREQ=WEEKLY");
    repo.upsert(e, 10, OffsetDateTime.now().minusMinutes(1)); // 이번 회차 due
    long rid = reminderId(e);

    OffsetDateTime nextOccurrence = start.plusDays(14); // 다음(2회차 이후) 시각으로 재무장 가정
    repo.rearm(List.of(new Rearm(rid, nextOccurrence.minusMinutes(10))));

    assertThat(nextFireOf(e)).isEqualTo(nextOccurrence.minusMinutes(10));
  }

  @Test
  void deleteByEvent_removesReminder() {
    long u = user();
    long e = event(u, OffsetDateTime.now().plusHours(1));
    repo.upsert(e, 10, OffsetDateTime.now().plusMinutes(50));

    repo.deleteByEvent(e);

    assertThat(dsl.fetchCount(EVENT_REMINDER, EVENT_REMINDER.EVENT_ID.eq(e))).isZero();
  }
}
