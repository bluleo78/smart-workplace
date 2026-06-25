package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** RSVP 응답 + 응답 DTO 참석자 노출 검증. */
@Transactional
class CalendarRsvpTest extends IntegrationTestBase {
  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;

  private static final OffsetDateTime now = OffsetDateTime.parse("2026-06-25T10:00:00Z");

  /** 테스트용 사용자 삽입 후 ID 반환. */
  private long seedUser(String suffix) {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "rsvp_" + suffix + "_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U " + suffix + " " + t)
        .set(USER.EMAIL, t + "_" + suffix + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 일정 요청 헬퍼(참석자 목록 지정). */
  private CalendarEventRequest newReq(
      String title, OffsetDateTime s, OffsetDateTime e, List<Long> attendees) {
    return new CalendarEventRequest(
        title, null, s, e, false, null, null, null, null, attendees);
  }

  // 참석자는 본인 RSVP 만 변경할 수 있다.
  @Test
  void attendee_respondsOwnRsvp() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long eventId =
        service.create(org, newReq("m", now, now.plusHours(1), List.of(guest))).id();
    service.respondRsvp(guest, eventId, "ACCEPTED");
    var mine = service.get(guest, eventId);
    assertThat(mine.myRsvpStatus()).isEqualTo("ACCEPTED");
  }

  // 참석자가 아닌 사용자는 RSVP 불가(비가시).
  @Test
  void nonAttendee_cannotRsvp() {
    long org = seedUser("org");
    long stranger = seedUser("x");
    long eventId =
        service.create(org, newReq("m", now, now.plusHours(1), List.of())).id();
    assertThatThrownBy(() -> service.respondRsvp(stranger, eventId, "ACCEPTED"))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  // list 응답은 경량(attendeeCount/myRsvpStatus 채움, attendees=null).
  @Test
  void list_returnsLightweightAttendeeInfo() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long eventId =
        service.create(org, newReq("m", now, now.plusHours(1), List.of(guest))).id();
    var listed =
        service.list(org, now.minusDays(1), now.plusDays(1)).stream()
            .filter(e -> e.id() == eventId)
            .findFirst()
            .get();
    assertThat(listed.attendeeCount()).isEqualTo(2); // 주최자+게스트
    assertThat(listed.myRsvpStatus()).isEqualTo("ACCEPTED"); // 주최자 본인
    assertThat(listed.attendees()).isNull();
  }
}
