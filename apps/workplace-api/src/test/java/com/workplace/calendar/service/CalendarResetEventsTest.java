package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.exception.CalendarNotFoundException;
import com.workplace.calendar.exception.ExternalCalendarResetNotAllowedException;
import com.workplace.calendar.repository.ExternalCalendarRepository;
import com.workplace.calendar.repository.ExternalCalendarRepository.ExternalEventRow;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 캘린더 강제 리셋(모든 일정 하드 삭제) 통합 테스트.
 *
 * <p>로컬 캘린더만 허용하고, 외부 연동 캘린더(읽기전용·쓰기가능 무관)는 external_account_id 기준으로 거부됨을 검증한다. event_attendee
 * CASCADE 와 교차 소유 격리도 확인.
 */
class CalendarResetEventsTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;
  @Autowired ExternalCalendarRepository extRepo;
  @Autowired CalendarEventService eventService;
  @Autowired CalendarService calendarService;

  private static final long TENANT_ID = 1L;
  private static final OffsetDateTime S = OffsetDateTime.parse("2026-07-10T09:00:00Z");

  private long ownerId;
  private long accountId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              ownerId = TestFixtures.createHuman(dsl);
              accountId = seedGraphAccount(ownerId);
              return null;
            });
  }

  @AfterEach
  void tearDown() {
    final long uid = ownerId;
    final long aid = accountId;
    cleanupInTenant(
        TENANT_ID,
        () -> {
          dsl.deleteFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(CALENDAR).where(CALENDAR.OWNER_ID.eq(uid)).execute();
          dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(aid)).execute();
          dsl.execute("DELETE FROM \"user\" WHERE id = ?", uid);
        });
    TenantContext.clear();
  }

  /** 로컬 캘린더 리셋 → 그 캘린더 일정·참석자 0, 다른 캘린더 일정은 보존. */
  @Test
  void reset_localCalendar_deletesOnlyThatCalendarsEvents() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long target =
                  calendarService.create(ownerId, new CalendarRequest("업무", "blue", null)).id();
              long other =
                  calendarService.create(ownerId, new CalendarRequest("개인", "green", null)).id();
              eventService.create(ownerId, evt("회의1", target));
              eventService.create(ownerId, evt("회의2", target));
              long keptId = eventService.create(ownerId, evt("보존", other)).id();

              calendarService.resetEvents(ownerId, target);

              assertThat(countEvents(target)).isZero();
              assertThat(countEvents(other)).isEqualTo(1);
              // event_attendee CASCADE — 주최자 행도 함께 삭제됨(보존 캘린더 1건만 남음)
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EVENT_ATTENDEE).where(EVENT_ATTENDEE.EVENT_ID.eq(keptId))))
                  .isEqualTo(1);
              status.setRollbackOnly();
              return null;
            });
  }

  /** 기본 캘린더도 리셋 허용(컨테이너는 존속, 일정만 비움). */
  @Test
  void reset_defaultCalendar_isAllowed() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long def = calendarService.ensureDefault(ownerId);
              eventService.create(ownerId, evt("기본일정", def));

              calendarService.resetEvents(ownerId, def);

              assertThat(countEvents(def)).isZero();
              assertThat(dsl.fetchExists(dsl.selectFrom(CALENDAR).where(CALENDAR.ID.eq(def))))
                  .isTrue();
              status.setRollbackOnly();
              return null;
            });
  }

  /** 읽기전용 연동 캘린더 리셋 → 409 예외, 일정 보존. */
  @Test
  void reset_readOnlyExternalCalendar_isRejected() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ext =
                  extRepo.upsertExternalCalendar(ownerId, accountId, "ext-ro", "공휴일", "blue", true);
              extRepo.upsertExternalEvent(
                  ownerId,
                  ext,
                  "e-ro",
                  new ExternalEventRow("외부", null, S, S.plusHours(1), false, null));

              assertThatThrownBy(() -> calendarService.resetEvents(ownerId, ext))
                  .isInstanceOf(ExternalCalendarResetNotAllowedException.class);
              assertThat(countEvents(ext)).isEqualTo(1);
              status.setRollbackOnly();
              return null;
            });
  }

  /** 쓰기 가능 연동 캘린더(is_read_only=false)도 리셋 거부 — external_account_id 기준 가드 teeth. */
  @Test
  void reset_writableExternalCalendar_isRejected() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ext =
                  extRepo.upsertExternalCalendar(
                      ownerId, accountId, "ext-rw", "Calendar", "blue", false);
              extRepo.upsertExternalEvent(
                  ownerId,
                  ext,
                  "e-rw",
                  new ExternalEventRow("외부", null, S, S.plusHours(1), false, null));

              assertThatThrownBy(() -> calendarService.resetEvents(ownerId, ext))
                  .isInstanceOf(ExternalCalendarResetNotAllowedException.class);
              assertThat(countEvents(ext)).isEqualTo(1);
              status.setRollbackOnly();
              return null;
            });
  }

  /** 비소유자 리셋 → 404(CalendarNotFoundException), 일정 무영향. */
  @Test
  void reset_byNonOwner_throws404() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long other = TestFixtures.createHuman(dsl);
              long target =
                  calendarService.create(ownerId, new CalendarRequest("업무", "blue", null)).id();
              eventService.create(ownerId, evt("회의", target));

              assertThatThrownBy(() -> calendarService.resetEvents(other, target))
                  .isInstanceOf(CalendarNotFoundException.class);
              assertThat(countEvents(target)).isEqualTo(1);
              status.setRollbackOnly();
              return null;
            });
  }

  private CalendarEventRequest evt(String title, long calendarId) {
    return new CalendarEventRequest(
        title, null, S, S.plusHours(1), false, null, null, null, null, null, calendarId);
  }

  private int countEvents(long calendarId) {
    return dsl.fetchCount(
        dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.CALENDAR_ID.eq(calendarId)));
  }

  private long seedGraphAccount(long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "reset-test-" + userId + "@test.local")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "리셋 테스트 계정")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.OAUTH_REFRESH_TOKEN, encryption.encrypt("RT"))
        .set(EMAIL_ACCOUNT.OAUTH_TOKEN_EXPIRES_AT, OffsetDateTime.now().plusHours(1))
        .set(EMAIL_ACCOUNT.OAUTH_ACCESS_TOKEN, encryption.encrypt("FAKE_TOKEN"))
        .set(EMAIL_ACCOUNT.AI_ENABLED, false)
        .set(EMAIL_ACCOUNT.TENANT_ID, TENANT_ID)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }
}
