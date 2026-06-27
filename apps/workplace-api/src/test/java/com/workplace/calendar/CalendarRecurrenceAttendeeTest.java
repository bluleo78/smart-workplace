package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
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
    return dsl.insertInto(USER)
        .set(USER.USERNAME, prefix + "_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, prefix + " " + t)
        .set(USER.EMAIL, prefix + "_" + t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
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
                newReq("수정회의", occ2, occ2.plusHours(1), List.of(guest)),
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
                newRecurringReq("daily", occ3, occ3.plusHours(1), List.of(guest)),
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
}
