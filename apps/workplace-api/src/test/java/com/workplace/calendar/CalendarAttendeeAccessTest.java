package com.workplace.calendar;

import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
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

/** 주최자 자동 행 삽입 + 참석자 가시성 역전 통합 테스트. 각 테스트는 @Transactional 롤백으로 격리. */
@Transactional
class CalendarAttendeeAccessTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;
  @Autowired EventAttendeeRepository attendeeRepo;

  private static final OffsetDateTime now = OffsetDateTime.parse("2026-07-01T09:00:00Z");

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

  /** 일정 요청 헬퍼 — attendeeUserIds 포함. */
  private CalendarEventRequest newReq(
      String title, OffsetDateTime s, OffsetDateTime e, List<Long> attendees) {
    return new CalendarEventRequest(
        title, null, s, e, false, null, null, null, null, attendees, null);
  }

  /** 초대받은 참석자는 자신의 list/get 에서 그 일정을 볼 수 있다(가시성 역전). */
  @Test
  void invitee_seesEventInListAndGet() {
    long organizer = seedUser("org");
    long invitee = seedUser("guest");
    CalendarEventRequest req = newReq("회의", now, now.plusHours(1), List.of(invitee));
    long eventId = service.create(organizer, req).id();

    // 피초대자 관점: list 에 등장
    var listed = service.list(invitee, now.minusDays(1), now.plusDays(1));
    assertThat(listed).extracting(CalendarEventResponse::id).contains(eventId);
    // get 도 200
    assertThat(service.get(invitee, eventId).id()).isEqualTo(eventId);
  }

  /** 주최자 본인은 ORGANIZER/ACCEPTED 행을 자동으로 갖는다. */
  @Test
  void organizer_hasOrganizerRowAccepted() {
    long organizer = seedUser("org");
    long eventId = service.create(organizer, newReq("혼자", now, now.plusHours(1), List.of())).id();
    var rows = attendeeRepo.findByEvent(eventId);
    assertThat(rows).hasSize(1);
    assertThat(rows.get(0).role()).isEqualTo("ORGANIZER");
    assertThat(rows.get(0).rsvpStatus()).isEqualTo("ACCEPTED");
  }

  /** 무관한 사용자는 여전히 404/비가시. */
  @Test
  void stranger_cannotSee() {
    long organizer = seedUser("org");
    long stranger = seedUser("x");
    long eventId = service.create(organizer, newReq("비밀", now, now.plusHours(1), List.of())).id();
    assertThatThrownBy(() -> service.get(stranger, eventId))
        .isInstanceOf(CalendarEventNotFoundException.class);
  }

  /** AGENT 초대자는 ACCEPTED 강제, HUMAN 은 NEEDS_ACTION. */
  @Test
  void agentInvitee_isAcceptedImmediately() {
    long organizer = seedUser("org");
    long agentId = createAgentUserWithMembership("agent");
    long humanId = seedUser("human");
    long eventId =
        service
            .create(organizer, newReq("팀회의", now, now.plusHours(1), List.of(agentId, humanId)))
            .id();

    var rows = attendeeRepo.findByEvent(eventId);
    // AGENT 행 찾아 ACCEPTED 검증
    assertThat(rows)
        .filteredOn(r -> r.userId() == agentId)
        .extracting(EventAttendeeRepository.AttendeeRow::rsvpStatus)
        .containsExactly("ACCEPTED");
    // HUMAN 행 찾아 NEEDS_ACTION 검증
    assertThat(rows)
        .filteredOn(r -> r.userId() == humanId)
        .extracting(EventAttendeeRepository.AttendeeRow::rsvpStatus)
        .containsExactly("NEEDS_ACTION");
  }

  /** 이 워크스페이스 구성원이 아닌 사용자 id 로는 초대할 수 없다(#852) — 생성·사전검증·참석자 추가 모두 400 사유로 거절하고 행을 남기지 않는다. */
  @Test
  void nonMemberInvitee_isRejected() {
    long organizer = seedUser("org");
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    // 멤버십 없는 사용자 — user 는 전역 테이블이라 다른 테넌트 사용자와 같은 상태다.
    long outsider =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "outsider_" + t)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "outsider")
            .set(USER.EMAIL, "outsider_" + t + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    CalendarEventRequest req = newReq("외부인 초대", now, now.plusHours(1), List.of(outsider));

    assertThatThrownBy(() -> service.validateCreatable(organizer, req))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("userId=[" + outsider + "]");
    assertThatThrownBy(() -> service.create(organizer, req))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(service.list(organizer, now.minusDays(1), now.plusDays(1))).isEmpty();

    long eventId = service.create(organizer, newReq("회의", now, now.plusHours(1), List.of())).id();
    assertThatThrownBy(() -> service.inviteAttendees(organizer, eventId, List.of(outsider)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(attendeeRepo.findByEvent(eventId)).hasSize(1); // 주최자만
  }
}
