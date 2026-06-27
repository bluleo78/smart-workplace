package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_REMINDER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.repository.EventReminderRepository.DueReminder;
import com.workplace.calendar.service.CalendarService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** EventReminderRepository — upsert(재무장)/due 판정/markFired/삭제. 메서드 롤백 격리. */
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

  /** ownerId 의 일정 1건 시드(starts_at 지정) 후 eventId 반환. V104 NOT NULL: calendar_id 필수 — 기본 캘린더 보장. */
  private long event(long ownerId, OffsetDateTime startsAt) {
    long calId = calendarService.ensureDefault(ownerId);
    return dsl.insertInto(CALENDAR_EVENT)
        .set(CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(CALENDAR_EVENT.TITLE, "회의")
        .set(CALENDAR_EVENT.STARTS_AT, startsAt)
        .set(CALENDAR_EVENT.ENDS_AT, startsAt.plusHours(1))
        .set(CALENDAR_EVENT.ALL_DAY, false)
        .set(CALENDAR_EVENT.CALENDAR_ID, calId)
        .returning(CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }

  private Integer leadOf(long eventId) {
    return dsl.select(EVENT_REMINDER.LEAD_MINUTES)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.LEAD_MINUTES);
  }

  private OffsetDateTime firedOf(long eventId) {
    return dsl.select(EVENT_REMINDER.FIRED_AT)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.FIRED_AT);
  }

  @Test
  void upsert_isIdempotentPerEvent_rearmsOnlyWhenLeadChanges() {
    long u = user();
    long e = event(u, OffsetDateTime.now().plusHours(2));

    repo.upsert(e, 10);
    assertThat(leadOf(e)).isEqualTo(10);

    // 같은 이벤트 재설정 → 1건 유지(교체), lead 갱신
    repo.upsert(e, 60);
    assertThat(leadOf(e)).isEqualTo(60);
    assertThat(dsl.fetchCount(EVENT_REMINDER, EVENT_REMINDER.EVENT_ID.eq(e))).isEqualTo(1);

    repo.markFired(List.of(reminderId(e)));
    assertThat(firedOf(e)).isNotNull();

    // 같은 lead 로 재저장(다른 필드만 수정한 상황) → 재무장 안 함(fired_at 유지) — 중복 발화 방지
    repo.upsert(e, 60);
    assertThat(firedOf(e)).isNotNull();

    // lead 변경 → 재무장(fired_at null)
    repo.upsert(e, 10);
    assertThat(firedOf(e)).isNull();
  }

  private long reminderId(long eventId) {
    return dsl.select(EVENT_REMINDER.ID)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.ID);
  }

  @Test
  void findDue_returnsOnlyPastDueUnfired_withOwner() {
    long u = user();
    // 발화 시점 도달(시작 5분 전, 시작이 3분 후 → 이미 due)
    long dueEvent = event(u, OffsetDateTime.now().plusMinutes(3));
    repo.upsert(dueEvent, 5);
    // 아직 멀었음(시작 2시간 후, 10분 전 리마인더 → 미도달)
    long futureEvent = event(u, OffsetDateTime.now().plusHours(2));
    repo.upsert(futureEvent, 10);

    List<DueReminder> due = repo.findDue();

    assertThat(due).extracting(DueReminder::eventId).contains(dueEvent).doesNotContain(futureEvent);
    DueReminder d = due.stream().filter(x -> x.eventId() == dueEvent).findFirst().orElseThrow();
    assertThat(d.ownerId()).isEqualTo(u);
  }

  @Test
  void markFired_excludesFromFindDue() {
    long u = user();
    long e = event(u, OffsetDateTime.now().plusMinutes(1));
    repo.upsert(e, 10);
    long rid = repo.findDue().stream().findFirst().orElseThrow().reminderId();

    repo.markFired(List.of(rid));

    assertThat(repo.findDue()).extracting(DueReminder::eventId).doesNotContain(e);
  }

  @Test
  void deleteByEvent_removesReminder() {
    long u = user();
    long e = event(u, OffsetDateTime.now().plusHours(1));
    repo.upsert(e, 10);

    repo.deleteByEvent(e);

    assertThat(dsl.fetchCount(EVENT_REMINDER, EVENT_REMINDER.EVENT_ID.eq(e))).isZero();
  }
}
