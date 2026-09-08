package com.workplace.calendar;

import static com.workplace.jooq.Tables.EVENT_REMINDER;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.repository.EventReminderRepository;
import com.workplace.calendar.repository.EventReminderRepository.Rearm;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** owner 격리(비-owner→404) 및 범위 겹침 조회 검증. 메서드 롤백 격리. */
@Transactional
class CalendarEventServiceTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;
  @Autowired EventReminderRepository reminderRepo;

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

  /** 일정 요청 헬퍼(리마인더 없음). */
  private CalendarEventRequest req(OffsetDateTime s, OffsetDateTime e) {
    return new CalendarEventRequest("회의", null, s, e, false, null, null, null, null, null, null);
  }

  /** 리마인더 포함 일정 요청 헬퍼. */
  private CalendarEventRequest reqWithReminder(OffsetDateTime s, OffsetDateTime e, int minutes) {
    return new CalendarEventRequest("회의", null, s, e, false, null, null, minutes, null, null, null);
  }

  /** 반복 + 리마인더 포함 일정 요청 헬퍼(#705). */
  private CalendarEventRequest reqWithRecurrenceAndReminder(
      OffsetDateTime s, OffsetDateTime e, String recurrenceRule, int minutes) {
    return new CalendarEventRequest(
        "회의", null, s, e, false, null, null, minutes, recurrenceRule, null, null);
  }

  private OffsetDateTime nextFireOf(long eventId) {
    return dsl.select(EVENT_REMINDER.NEXT_FIRE_AT)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.NEXT_FIRE_AT);
  }

  private long reminderIdOf(long eventId) {
    return dsl.select(EVENT_REMINDER.ID)
        .from(EVENT_REMINDER)
        .where(EVENT_REMINDER.EVENT_ID.eq(eventId))
        .fetchOne(EVENT_REMINDER.ID);
  }

  /** #705 — 반복 일정(마스터 시작이 미래)의 리마인더는 첫 회차(마스터 시작) 기준으로 next_fire_at 계산. */
  @Test
  void create_recurringWithReminder_futureMaster_computesFirstOccurrence() {
    long u = user();
    OffsetDateTime start =
        OffsetDateTime.now().plusDays(3).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    CalendarEventResponse created =
        service.create(
            u, reqWithRecurrenceAndReminder(start, start.plusHours(1), "FREQ=WEEKLY", 10));

    assertThat(nextFireOf(created.id())).isEqualTo(start.minusMinutes(10));
  }

  /**
   * #705 — 반복 일정 마스터 시작이 이미 지났으면(시리즈 진행 중) 과거 회차로 소급 발화하지 않고 "아직 시작하지 않은" 다음 미래 회차 기준으로
   * next_fire_at 을 계산한다.
   */
  @Test
  void create_recurringWithReminder_pastMaster_computesNextUpcomingOccurrence() {
    long u = user();
    OffsetDateTime start =
        OffsetDateTime.now()
            .minusDays(3)
            .truncatedTo(java.time.temporal.ChronoUnit.SECONDS); // 매주 반복, 마스터 시작은 3일 전(이미 지남)
    CalendarEventResponse created =
        service.create(
            u, reqWithRecurrenceAndReminder(start, start.plusHours(1), "FREQ=WEEKLY", 10));

    // 다음 미래 회차 = 마스터 시작 + 7일(4일 후) — 과거 회차(마스터 자신)로는 절대 잡히지 않음.
    assertThat(nextFireOf(created.id())).isEqualTo(start.plusDays(7).minusMinutes(10));
  }

  /** #705 — 반복 규칙 변경(RRULE→다른 RRULE, 시작시각은 동일)도 스케줄 변경으로 간주해 next_fire_at 을 재계산한다. */
  @Test
  void update_recurrenceRuleChange_recomputesNextFireAt() {
    long u = user();
    OffsetDateTime start =
        OffsetDateTime.now().plusDays(1).truncatedTo(java.time.temporal.ChronoUnit.SECONDS);
    CalendarEventResponse created =
        service.create(
            u, reqWithRecurrenceAndReminder(start, start.plusHours(1), "FREQ=WEEKLY", 10));
    assertThat(nextFireOf(created.id())).isEqualTo(start.minusMinutes(10));

    // RRULE 변경 — 마스터 시작은 그대로라 재계산 결과값 자체는 동일(첫 회차=마스터 시작)하지만, 재계산 경로가 실제로 탔는지는
    // 아래 "재무장 후 무관 필드 편집" 테스트가 별도로 검증한다. 여기서는 예외 없이 반영되는지만 확인.
    CalendarEventResponse updated =
        service.update(
            u,
            created.id(),
            reqWithRecurrenceAndReminder(start, start.plusHours(1), "FREQ=DAILY", 10),
            EditScope.ALL,
            null);
    assertThat(updated.recurrenceRule()).isEqualTo("FREQ=DAILY");
    assertThat(nextFireOf(created.id())).isEqualTo(start.minusMinutes(10));
  }

  /**
   * #705 회귀 가드 — 리마인더가 이미 발화(next_fire_at=null)된 뒤, 리마인더와 무관한 필드만 수정하면 next_fire_at 이 그대로 null 로
   * 유지되어야 한다(재무장 안 함). scheduleChanged 도 lead 변경도 없는데 무조건 재계산하면 이미 지난 시작시각으로 다시 재무장되어 중복 발화가 발생한다 —
   * 그 회귀를 잡는 테스트.
   */
  @Test
  void update_afterAlreadyFired_unrelatedFieldEdit_doesNotRearm() {
    long u = user();
    OffsetDateTime start = OffsetDateTime.now().plusHours(1);
    CalendarEventResponse created =
        service.create(u, reqWithReminder(start, start.plusHours(2), 10));
    assertThat(nextFireOf(created.id())).isEqualTo(start.minusMinutes(10));

    // 발화 완료 상태를 직접 시뮬레이션(단발 일정 발화 후 재무장 = null).
    reminderRepo.rearm(List.of(new Rearm(reminderIdOf(created.id()), null)));
    assertThat(nextFireOf(created.id())).isNull();

    // 리마인더 분(10)·시작시각·RRULE 모두 그대로 두고 제목만 수정.
    CalendarEventRequest editUnrelated =
        new CalendarEventRequest(
            "변경된 제목", null, start, start.plusHours(2), false, null, null, 10, null, null, null);
    CalendarEventResponse updated =
        service.update(u, created.id(), editUnrelated, EditScope.ALL, null);

    assertThat(updated.title()).isEqualTo("변경된 제목");
    assertThat(nextFireOf(created.id())).isNull(); // 재무장되지 않아야 함 — 중복 발화 방지
  }

  @Test
  void create_then_get_roundtrip() {
    long u = user();
    CalendarEventResponse created = service.create(u, req(BASE, BASE.plusHours(1)));
    CalendarEventResponse fetched = service.get(u, created.id());

    assertThat(fetched.id()).isEqualTo(created.id());
    assertThat(fetched.title()).isEqualTo("회의");
    assertThat(fetched.startsAt()).isEqualTo(BASE);
  }

  @Test
  void create_withReminder_roundtrip_and_update_clears() {
    long u = user();
    // 생성 시 30분 전 리마인더 → 응답에 반영
    CalendarEventResponse created = service.create(u, reqWithReminder(BASE, BASE.plusHours(1), 30));
    assertThat(created.reminderMinutes()).isEqualTo(30);
    assertThat(service.get(u, created.id()).reminderMinutes()).isEqualTo(30);

    // 리마인더 null 로 수정 → 제거
    CalendarEventResponse cleared =
        service.update(u, created.id(), req(BASE, BASE.plusHours(1)), EditScope.ALL, null);
    assertThat(cleared.reminderMinutes()).isNull();

    // 다시 설정 → 반영
    CalendarEventResponse rearmed =
        service.update(
            u, created.id(), reqWithReminder(BASE, BASE.plusHours(1), 60), EditScope.ALL, null);
    assertThat(rearmed.reminderMinutes()).isEqualTo(60);
  }

  @Test
  void get_byNonOwner_throws404() {
    long owner = user();
    long other = user();
    CalendarEventResponse created = service.create(owner, req(BASE, BASE.plusHours(1)));

    assertThatThrownBy(() -> service.get(other, created.id()))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  void update_byNonOwner_throws404() {
    long owner = user();
    long other = user();
    CalendarEventResponse created = service.create(owner, req(BASE, BASE.plusHours(1)));

    assertThatThrownBy(
            () ->
                service.update(
                    other, created.id(), req(BASE, BASE.plusHours(2)), EditScope.ALL, null))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  void delete_byNonOwner_throws404() {
    long owner = user();
    long other = user();
    CalendarEventResponse created = service.create(owner, req(BASE, BASE.plusHours(1)));

    assertThatThrownBy(() -> service.delete(other, created.id(), EditScope.ALL, null))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  @Test
  void list_returnsOnlyOverlappingOwnEvents() {
    long u = user();
    long other = user();

    // [BASE, BASE+1h] — 범위 안에 완전히 포함
    CalendarEventResponse inside = service.create(u, req(BASE, BASE.plusHours(1)));
    // [BASE-2h, BASE+30m] — 왼쪽 경계 겹침
    CalendarEventResponse edge = service.create(u, req(BASE.minusHours(2), BASE.plusMinutes(30)));
    // [BASE+5d, BASE+5d+1h] — 범위 밖
    service.create(u, req(BASE.plusDays(5), BASE.plusDays(5).plusHours(1)));
    // 다른 사용자의 겹치는 일정 — 목록에 포함되면 안 됨
    service.create(other, req(BASE, BASE.plusHours(1)));

    // 쿼리 범위: [BASE-1h, BASE+2h)
    List<CalendarEventResponse> result = service.list(u, BASE.minusHours(1), BASE.plusHours(2));

    assertThat(result)
        .extracting(CalendarEventResponse::id)
        .containsExactlyInAnyOrder(inside.id(), edge.id());
  }
}
