package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.exception.CalendarEventNotFoundException;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/** 참석자 추가/제거 뮤테이션 통합 테스트. 각 테스트는 @Transactional 롤백으로 격리. */
@Transactional
class CalendarAttendeeMutationTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;
  @Autowired EventAttendeeRepository attendeeRepo;

  private static final OffsetDateTime now = OffsetDateTime.parse("2026-07-01T09:00:00Z");

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

  /** 일정 요청 헬퍼. */
  private CalendarEventRequest newReq(
      String title, OffsetDateTime s, OffsetDateTime e, List<Long> attendees) {
    return new CalendarEventRequest(
        title, null, s, e, false, null, null, null, null, attendees, null);
  }

  // 주최자만 참석자를 추가할 수 있다.
  @Test
  void nonOrganizer_cannotInvite() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long other = seedUser("o");
    long eventId = service.create(org, newReq("m", now, now.plusHours(1), List.of(guest))).id();
    assertThatThrownBy(() -> service.inviteAttendees(guest, eventId, List.of(other)))
        .isInstanceOf(CalendarEventNotFoundException.class); // 비주최자=비가시(404 은닉)
  }

  // AGENT 참석자는 ACCEPTED 로 추가된다.
  @Test
  void agentInvited_isAccepted() {
    long org = seedUser("org");
    long ai = createAgentUser("ai");
    long eventId = service.create(org, newReq("m", now, now.plusHours(1), List.of())).id();
    service.inviteAttendees(org, eventId, List.of(ai));
    var row =
        attendeeRepo.findByEvent(eventId).stream().filter(a -> a.userId() == ai).findFirst().get();
    assertThat(row.rsvpStatus()).isEqualTo("ACCEPTED");
  }

  // 주최자는 참석자를 제거할 수 있다.
  @Test
  void organizer_removesAttendee() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long eventId = service.create(org, newReq("m", now, now.plusHours(1), List.of(guest))).id();
    service.removeAttendee(org, eventId, guest);
    assertThat(attendeeRepo.existsForUser(eventId, guest)).isFalse();
  }

  // 주최자는 자기 자신을 제거할 수 없다 (ORGANIZER 행 보호).
  @Test
  void organizer_cannotRemoveSelf() {
    long org = seedUser("org");
    long eventId = service.create(org, newReq("m", now, now.plusHours(1), List.of())).id();
    service.removeAttendee(org, eventId, org); // userId==callerId → 삭제 없이 반환
    assertThat(attendeeRepo.existsForUser(eventId, org)).isTrue();
  }

  // 비주최자는 참석자를 제거할 수 없다 (404 은닉).
  @Test
  void nonOrganizer_cannotRemove() {
    long org = seedUser("org");
    long guest = seedUser("g");
    long eventId = service.create(org, newReq("m", now, now.plusHours(1), List.of(guest))).id();
    assertThatThrownBy(() -> service.removeAttendee(guest, eventId, org))
        .isInstanceOf(CalendarEventNotFoundException.class); // 비주최자=비가시(404 은닉)
  }
}
