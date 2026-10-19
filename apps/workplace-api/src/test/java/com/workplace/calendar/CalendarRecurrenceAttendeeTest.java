package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.repository.EventAttendeeRepository.AttendeeRow;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 반복 일정 오버라이드/분할 시 참석자 복사 검증. 메서드 롤백 격리. */
@Transactional
class CalendarRecurrenceAttendeeTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;
  @Autowired EventAttendeeRepository attendeeRepo;

  private static final OffsetDateTime BASE = OffsetDateTime.parse("2026-07-01T09:00:00Z");

  /** 테스트용 HUMAN 사용자 시드 후 ID 반환. */
  private long seedUser(String prefix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return withMembership(
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix + " " + t)
            .set(USER.EMAIL, prefix + "_" + t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId());
  }

  /** 반복 일정 요청 헬퍼(RRULE 포함, 참석자 포함). */
  private CalendarEventRequest newRecurringReq(
      String freq, OffsetDateTime s, OffsetDateTime e, List<Long> attendees) {
    return new CalendarEventRequest(
        "회의", null, s, e, false, null, null, null, "FREQ=" + freq.toUpperCase(), attendees, null);
  }

  /** 단순 일정 요청 헬퍼(RRULE 없음). */
  private CalendarEventRequest newReq(
      String title, OffsetDateTime s, OffsetDateTime e, List<Long> attendees) {
    return new CalendarEventRequest(
        title, null, s, e, false, null, null, null, null, attendees, null);
  }

  /**
   * scope=THIS 오버라이드(별도 행 생성) 시 마스터의 참석자가 오버라이드 행으로 복사된다. 주최자(ORGANIZER/ACCEPTED) + 게스트 모두 복사됨을 검증.
   */
  @Test
  void overrideOccurrence_copiesAttendees() {
    long org = seedUser("org");
    long guest = seedUser("g");
    // 매일 반복 일정 생성(주최자 + 게스트 1명)
    long masterId =
        service.create(org, newRecurringReq("daily", BASE, BASE.plusHours(1), List.of(guest))).id();

    // 두 번째 회차를 THIS 로 수정 → 오버라이드 calendar_event 행 생성
    OffsetDateTime occ2 = BASE.plusDays(1);
    long overrideId =
        service
            .update(
                org,
                masterId,
                newReq(
                    "수정회의",
                    occ2,
                    occ2.plusHours(1),
                    List.of() /* 수정은 참석자를 받지 않는다(#852) — 참석자는 원본에서 복사 */),
                EditScope.THIS,
                occ2)
            .id();

    // 오버라이드 행에 주최자+게스트 참석자 복사됨을 단언
    List<AttendeeRow> overrideAttendees = attendeeRepo.findByEvent(overrideId);
    assertThat(overrideAttendees)
        .extracting(AttendeeRow::userId)
        .as("오버라이드 행에 주최자와 게스트가 모두 복사되어야 한다")
        .contains(org, guest);
  }

  /**
   * scope=THIS_AND_FOLLOWING 분할 시 기존 마스터의 참석자가 새 마스터 행으로 복사된다. 주최자(ORGANIZER/ACCEPTED) + 게스트 모두
   * 복사됨을 검증.
   */
  @Test
  void splitSeries_copiesAttendeesToNewMaster() {
    long org = seedUser("org");
    long guest = seedUser("g");
    // 매일 반복 일정 생성(주최자 + 게스트 1명)
    long oldMasterId =
        service.create(org, newRecurringReq("daily", BASE, BASE.plusHours(1), List.of(guest))).id();

    // 3번째 회차부터 THIS_AND_FOLLOWING 으로 분할 → 새 마스터 행 생성
    OffsetDateTime occ3 = BASE.plusDays(2);
    long newMasterId =
        service
            .update(
                org,
                oldMasterId,
                newRecurringReq(
                    "daily",
                    occ3,
                    occ3.plusHours(1),
                    List.of() /* 수정은 참석자를 받지 않는다(#852) — 참석자는 원본에서 복사 */),
                EditScope.THIS_AND_FOLLOWING,
                occ3)
            .id();

    // 새 마스터 행에 주최자+게스트 참석자 복사됨을 단언
    List<AttendeeRow> newMasterAttendees = attendeeRepo.findByEvent(newMasterId);
    assertThat(newMasterAttendees)
        .extracting(AttendeeRow::userId)
        .as("분할된 새 마스터 행에 주최자와 게스트가 모두 복사되어야 한다")
        .contains(org, guest);
  }

  /** THIS 오버라이드 하나를 만든 매일 반복 일정 — [마스터 id, 오버라이드 id]. */
  private long[] seriesWithOverride(long org, List<Long> guests) {
    long masterId =
        service.create(org, newRecurringReq("daily", BASE, BASE.plusHours(1), guests)).id();
    OffsetDateTime occ2 = BASE.plusDays(1);
    long overrideId =
        service
            .update(
                org,
                masterId,
                newReq("수정회의", occ2.plusHours(2), occ2.plusHours(3), List.of()),
                EditScope.THIS,
                occ2)
            .id();
    return new long[] {masterId, overrideId};
  }

  /**
   * WP-536: 반복 일정(마스터)에 참석자를 추가하면 이미 「이 일정만」 고친 회차에도 들어가야 한다 — 마스터에만 넣으면 새 참석자는 고친 회차를 목록에서도 못 보고
   * 열면 404 였다.
   */
  @Test
  void inviteToMaster_alsoAddsToExistingOverrides() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long added = seedUser("add");
    long[] ids = seriesWithOverride(org, List.of(guest));

    service.inviteAttendees(org, ids[0], List.of(added));

    assertThat(attendeeRepo.findByEvent(ids[1]))
        .as("고친 회차에도 새 참석자가 들어가야 한다")
        .anySatisfy(
            a -> {
              assertThat(a.userId()).isEqualTo(added);
              assertThat(a.rsvpStatus()).isEqualTo("NEEDS_ACTION");
            });
    assertThat(service.get(added, ids[1]).id()).isEqualTo(ids[1]);
  }

  /** WP-536: 반복 일정(마스터)에서 참석자를 빼면 고친 회차에서도 빠져 더는 보거나 열 수 없어야 한다. */
  @Test
  void removeFromMaster_alsoRemovesFromOverrides() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long[] ids = seriesWithOverride(org, List.of(guest));

    service.removeAttendee(org, ids[0], guest);

    assertThat(attendeeRepo.findByEvent(ids[1]))
        .extracting(AttendeeRow::userId)
        .as("고친 회차에서도 빠져야 한다")
        .doesNotContain(guest)
        .contains(org);
    assertThatThrownBy(() -> service.get(guest, ids[1]))
        .isInstanceOf(CalendarEventNotFoundException.class);
    assertThat(
            service.list(guest, BASE.minusDays(1), BASE.plusDays(5)).stream()
                .map(e -> e.id())
                .toList())
        .as("빠진 사람의 목록에 고친 회차가 남지 않아야 한다")
        .doesNotContain(ids[1]);
  }
}
