package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarEventResponse;
import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.calendar.repository.EventAttendeeRepository;
import com.workplace.global.security.EncryptionService;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * DTO external/myRole 필드 및 외부 참석자(externalEmail) 통합 테스트. #547 Task 7 검증: get() 결과에 external,
 * myRole, externalEmail 이 올바르게 채워지는지 확인.
 */
class CalendarEventAttendeeGetTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarEventService eventService;
  @Autowired EventAttendeeRepository attendeeRepo;
  @Autowired CalendarRepository calendarRepo;
  @Autowired EncryptionService encryption;
  @Autowired PlatformTransactionManager txManager;

  private static final OffsetDateTime START = OffsetDateTime.parse("2026-07-10T09:00:00Z");

  /** 테스트용 HUMAN 사용자 시드 후 ID 반환. */
  private long seedUser() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "u_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "User " + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 외부(M365) 캘린더 컨테이너 삽입 — external_account_id + external_id 설정. */
  private long seedExternalCalendar(long uid) {
    long accId =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, uid)
            .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, uid + "@iacloud.kr")
            .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
            .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
            .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("AT"))
            .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
            .set(EMAIL_ACCOUNT.AI_ENABLED, false)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, uid)
        .set(CALENDAR.NAME, "업무 캘린더")
        .set(CALENDAR.COLOR, "blue")
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 0)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, accId)
        .set(CALENDAR.EXTERNAL_ID, "cal-ext-" + UUID.randomUUID())
        .set(CALENDAR.IS_READ_ONLY, false)
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  /**
   * external_id 있는 일정을 시드하고 내부 참석자(ORGANIZER)와 외부 참석자를 삽입한 뒤, get() 이 external=true,
   * myRole=ORGANIZER, 외부 참석자 AttendeeResponse 를 올바르게 반환하는지 검증한다.
   */
  @Test
  void get_external_event_returns_external_attendee_and_myRole_organizer() {
    TransactionTemplate tx = new TransactionTemplate(txManager);
    long ownerId = tx.execute(s -> seedUser());

    long eventId =
        tx.execute(
            s -> {
              // 외부 캘린더에 external_id 동반 일정 삽입
              long calId = seedExternalCalendar(ownerId);
              CalendarEventRequest req =
                  new CalendarEventRequest(
                      "외부 회의",
                      null,
                      START,
                      START.plusHours(1),
                      false,
                      null,
                      null,
                      null,
                      null,
                      null,
                      calId);
              // CalendarEventRepository 를 직접 사용할 수 없으므로 서비스로 삽입 후 리포지터리로 external_id 업데이트
              // → 간단하게 dsl 직접 INSERT with external_id
              long evId =
                  dsl.insertInto(com.workplace.jooq.Tables.CALENDAR_EVENT)
                      .set(com.workplace.jooq.Tables.CALENDAR_EVENT.OWNER_ID, ownerId)
                      .set(com.workplace.jooq.Tables.CALENDAR_EVENT.CALENDAR_ID, calId)
                      .set(com.workplace.jooq.Tables.CALENDAR_EVENT.EXTERNAL_ID, "ext-evt-test-1")
                      .set(com.workplace.jooq.Tables.CALENDAR_EVENT.TITLE, req.title())
                      .set(com.workplace.jooq.Tables.CALENDAR_EVENT.STARTS_AT, req.startsAt())
                      .set(com.workplace.jooq.Tables.CALENDAR_EVENT.ENDS_AT, req.endsAt())
                      .set(com.workplace.jooq.Tables.CALENDAR_EVENT.ALL_DAY, req.allDay())
                      .returning(com.workplace.jooq.Tables.CALENDAR_EVENT.ID)
                      .fetchOne()
                      .getId();
              // 주최자 내부 참석자 행
              attendeeRepo.insert(evId, ownerId, null, "ORGANIZER", "ACCEPTED");
              // 외부 참석자 행
              attendeeRepo.insertExternal(
                  evId, "ext@guest.com", "Guest User", "ATTENDEE", "DECLINED");
              return evId;
            });

    // get() 는 @Transactional(readOnly) 이므로 별도 tx 에서 호출
    CalendarEventResponse resp = tx.execute(s -> eventService.get(ownerId, eventId));

    // external 플래그 = external_id 보유 일정
    assertThat(resp.external()).isTrue();
    // myRole = 호출자(ownerId)의 역할 ORGANIZER
    assertThat(resp.myRole()).isEqualTo("ORGANIZER");
    // 외부 참석자 검증
    assertThat(resp.attendees())
        .anySatisfy(
            a -> {
              assertThat(a.kind()).isEqualTo("EXTERNAL");
              assertThat(a.externalEmail()).isEqualTo("ext@guest.com");
              assertThat(a.userId()).isNull();
            });
    // 내부 참석자(주최자) 검증
    assertThat(resp.attendees())
        .anySatisfy(
            a -> {
              assertThat(a.userId()).isEqualTo(ownerId);
              assertThat(a.role()).isEqualTo("ORGANIZER");
            });
  }

  /** 일반 로컬 일정(external_id 없음)은 external=false 를 반환한다. */
  @Test
  void get_local_event_returns_external_false() {
    TransactionTemplate tx = new TransactionTemplate(txManager);
    long ownerId = tx.execute(s -> seedUser());

    long eventId =
        tx.execute(
            s -> {
              long calId = calendarRepo.insert(ownerId, "기본", "blue", true, 0);
              CalendarEventRequest req =
                  new CalendarEventRequest(
                      "로컬 회의",
                      null,
                      START,
                      START.plusHours(1),
                      false,
                      null,
                      null,
                      null,
                      null,
                      null,
                      calId);
              long evId = eventService.create(ownerId, req).id();
              return evId;
            });

    CalendarEventResponse resp = tx.execute(s -> eventService.get(ownerId, eventId));
    assertThat(resp.external()).isFalse();
    assertThat(resp.myRole()).isEqualTo("ORGANIZER");
  }
}
