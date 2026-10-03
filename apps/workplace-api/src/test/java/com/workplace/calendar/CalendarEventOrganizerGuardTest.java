package com.workplace.calendar;

import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.exception.EventNotOrganizerException;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.calendar.service.CalendarEventService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 주최자 가드 통합 테스트(WP-200) — 내 캘린더에 있는 일정이라도 다른 사람이 주최한 미팅(동기화 사본: owner=나, 내 역할=ATTENDEE)은 수정·삭제할 수
 * 없어야 한다. 소유자만 보던 이전 술어는 이 사본의 시간 수정을 허용해, 주최자 사본과 시작시각이 어긋나며 같은 미팅이 두 번 보이는 중복을 만들었다.
 *
 * <p>@Transactional 롤백 격리. 동기화 사본은 로컬 일정의 참석자 행을 Graph syncAttendees 결과와 같은 모양(주최자=상대 ORGANIZER,
 * 나=ATTENDEE)으로 바꿔 시뮬레이션한다 — 가드는 외부/로컬 공통 술어(checkUpdatable·validateDeletable)에 있으므로 외부 transport
 * 없이 검증된다.
 */
@Transactional
class CalendarEventOrganizerGuardTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService service;
  @Autowired EventAttendeeRepository attendeeRepo;

  private static final OffsetDateTime T = OffsetDateTime.parse("2026-07-01T09:00:00Z");

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

  private CalendarEventRequest req(String title, OffsetDateTime s) {
    return new CalendarEventRequest(
        title, null, s, s.plusHours(1), false, null, null, null, null, null, null);
  }

  /** me 소유이지만 org 가 주최한 미팅 사본 — syncAttendees 결과 모양(org=ORGANIZER, me=ATTENDEE)으로 참석자 행을 맞춘다. */
  private long seedInvitedCopy(long me, long org) {
    long id = service.create(me, req("회의", T)).id();
    dsl.update(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.ROLE, "ATTENDEE")
        .where(EVENT_ATTENDEE.EVENT_ID.eq(id).and(EVENT_ATTENDEE.USER_ID.eq(me)))
        .execute();
    attendeeRepo.insert(id, org, null, "ORGANIZER", "ACCEPTED");
    return id;
  }

  @Test
  void attendeeOfOwnCopy_cannotUpdate() {
    long me = seedUser("me");
    long org = seedUser("org");
    long id = seedInvitedCopy(me, org);

    assertThatThrownBy(() -> service.update(me, id, req("회의", T.plusHours(2)), null, null))
        .isInstanceOf(EventNotOrganizerException.class);
    // AI 확인 카드·사전검증 경로(validateUpdatable)도 같은 술어로 막힌다.
    assertThatThrownBy(
            () -> service.validateUpdatable(me, id, req("회의", T.plusHours(2)), null, null))
        .isInstanceOf(EventNotOrganizerException.class);
    assertThat(service.get(me, id).startsAt().toInstant()).isEqualTo(T.toInstant());
  }

  @Test
  void attendeeOfOwnCopy_cannotDelete() {
    long me = seedUser("me");
    long org = seedUser("org");
    long id = seedInvitedCopy(me, org);

    assertThatThrownBy(() -> service.validateDeletable(me, id, null, null))
        .isInstanceOf(EventNotOrganizerException.class);
    assertThatThrownBy(() -> service.delete(me, id, null, null))
        .isInstanceOf(EventNotOrganizerException.class);
  }

  @Test
  void organizer_canUpdate() {
    long me = seedUser("me");
    long id = service.create(me, req("내 회의", T)).id(); // create 가 me 를 ORGANIZER 로 둔다

    service.update(me, id, req("내 회의", T.plusHours(2)), null, null);

    assertThat(service.get(me, id).startsAt().toInstant()).isEqualTo(T.plusHours(2).toInstant());
  }

  /** 참석자 행이 없는 일정(V89 이전 생성분) — 주최자 정보가 없으므로 소유자 수정이 그대로 허용된다. */
  @Test
  void ownerWithoutAttendeeRows_canUpdate() {
    long me = seedUser("me");
    long id = service.create(me, req("옛 일정", T)).id();
    dsl.deleteFrom(EVENT_ATTENDEE).where(EVENT_ATTENDEE.EVENT_ID.eq(id)).execute();

    service.update(me, id, req("옛 일정", T.plusHours(2)), null, null);

    assertThat(service.get(me, id).startsAt().toInstant()).isEqualTo(T.plusHours(2).toInstant());
  }

  /** 외부 이메일 주최자 미팅에 내가 ATTENDEE 로 있으면 막는다(외부 파트너가 연 회의의 내 사본). */
  @Test
  void externalOrganizer_meAttendee_cannotUpdate() {
    long me = seedUser("me");
    long id = service.create(me, req("외부 회의", T)).id();
    dsl.update(EVENT_ATTENDEE)
        .set(EVENT_ATTENDEE.ROLE, "ATTENDEE")
        .where(EVENT_ATTENDEE.EVENT_ID.eq(id).and(EVENT_ATTENDEE.USER_ID.eq(me)))
        .execute();
    attendeeRepo.insertExternal(id, "boss@partner.com", "Boss", "ORGANIZER", "ACCEPTED");

    assertThatThrownBy(() -> service.update(me, id, req("외부 회의", T.plusHours(2)), null, null))
        .isInstanceOf(EventNotOrganizerException.class);
  }

  /**
   * 외부 이메일 주최자이고 내 행이 없으면 허용 — 동기화가 별칭(UPN·보조 SMTP)으로 온 내 미팅을 외부 주최자로 저장할 수 있어, 확신 없이 내 미팅 수정을 막지
   * 않는다.
   */
  @Test
  void externalOrganizer_noOwnRow_canUpdate() {
    long me = seedUser("me");
    long id = service.create(me, req("별칭 회의", T)).id();
    dsl.deleteFrom(EVENT_ATTENDEE).where(EVENT_ATTENDEE.EVENT_ID.eq(id)).execute();
    attendeeRepo.insertExternal(id, "me.alias@example.com", "Me", "ORGANIZER", "ACCEPTED");

    service.update(me, id, req("별칭 회의", T.plusHours(2)), null, null);

    assertThat(service.get(me, id).startsAt().toInstant()).isEqualTo(T.plusHours(2).toInstant());
  }
}
