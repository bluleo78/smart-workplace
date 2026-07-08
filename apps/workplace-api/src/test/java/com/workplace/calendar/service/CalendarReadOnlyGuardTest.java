package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarEventRequest;
import com.workplace.calendar.dto.EditScope;
import com.workplace.calendar.exception.ReadOnlyCalendarException;
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
 * 읽기전용(외부 동기화) 캘린더·일정 쓰기 가드 통합 테스트.
 *
 * <p>ExternalCalendarRepository 로 is_read_only=true 컨테이너와 이벤트를 시드한 뒤, CalendarEventService /
 * CalendarService 의 쓰기 경로가 ReadOnlyCalendarException(→ 409)을 던지는지 확인한다.
 */
class CalendarReadOnlyGuardTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;
  @Autowired ExternalCalendarRepository extRepo;
  @Autowired CalendarEventService eventService;
  @Autowired CalendarService calendarService;

  private static final long TENANT_ID = 1L;

  private long ownerId;
  private long accountId;
  private long externalCalendarId;
  private long externalEventId;
  private long localEventId;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              ownerId = TestFixtures.createHuman(dsl);
              accountId = seedGraphAccount(ownerId);
              externalCalendarId =
                  extRepo.upsertExternalCalendar(
                      ownerId, accountId, "ext-cal-1", "업무", "blue", true);
              externalEventId =
                  extRepo.upsertExternalEvent(
                      ownerId,
                      externalCalendarId,
                      "ext-evt-1",
                      new ExternalEventRow(
                          "외부 회의",
                          null,
                          OffsetDateTime.parse("2026-07-10T09:00:00Z"),
                          OffsetDateTime.parse("2026-07-10T10:00:00Z"),
                          false,
                          null,
                          null));
              // 로컬 일정: 기본 캘린더(읽기전용 아님)에 생성 — 가드 오발동 회귀용
              long localCalId = calendarService.ensureDefault(ownerId);
              localEventId =
                  eventService
                      .create(
                          ownerId,
                          new CalendarEventRequest(
                              "로컬 회의",
                              null,
                              OffsetDateTime.parse("2026-07-11T09:00:00Z"),
                              OffsetDateTime.parse("2026-07-11T10:00:00Z"),
                              false,
                              null,
                              null,
                              null,
                              null,
                              null,
                              localCalId))
                      .id();
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

  /** 외부 동기화 이벤트를 수정하면 ReadOnlyCalendarException(409)이 발생한다. */
  @Test
  void update_externalEvent_isRejected() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              status.setRollbackOnly();
              CalendarEventRequest req =
                  new CalendarEventRequest(
                      "수정 시도",
                      null,
                      OffsetDateTime.parse("2026-07-10T09:00:00Z"),
                      OffsetDateTime.parse("2026-07-10T10:00:00Z"),
                      false,
                      null,
                      null,
                      null,
                      null,
                      null,
                      null);
              assertThatThrownBy(
                      () -> eventService.update(ownerId, externalEventId, req, EditScope.ALL, null))
                  .isInstanceOf(ReadOnlyCalendarException.class);
              return null;
            });
  }

  /** 외부 동기화 캘린더 컨테이너를 삭제하면 ReadOnlyCalendarException(409)이 발생한다. */
  @Test
  void delete_externalCalendarContainer_isRejected() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              status.setRollbackOnly();
              assertThatThrownBy(() -> calendarService.delete(ownerId, externalCalendarId))
                  .isInstanceOf(ReadOnlyCalendarException.class);
              return null;
            });
  }

  /** 읽기전용 컨테이너를 calendarId 로 지정해 일정을 생성하면 ReadOnlyCalendarException(409)이 발생한다. */
  @Test
  void create_intoReadOnlyContainer_isRejected() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              status.setRollbackOnly();
              CalendarEventRequest req =
                  new CalendarEventRequest(
                      "생성 시도",
                      null,
                      OffsetDateTime.parse("2026-07-15T09:00:00Z"),
                      OffsetDateTime.parse("2026-07-15T10:00:00Z"),
                      false,
                      null,
                      null,
                      null,
                      null,
                      null,
                      externalCalendarId); // 읽기전용 컨테이너를 생성 대상으로 지정
              assertThatThrownBy(() -> eventService.create(ownerId, req))
                  .isInstanceOf(ReadOnlyCalendarException.class);
              return null;
            });
  }

  /** 로컬 일정을 읽기전용 컨테이너로 이동하면 ReadOnlyCalendarException(409)이 발생한다. */
  @Test
  void move_localEventIntoReadOnlyContainer_isRejected() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              status.setRollbackOnly();
              CalendarEventRequest req =
                  new CalendarEventRequest(
                      "로컬 회의", // 제목 유지
                      null,
                      OffsetDateTime.parse("2026-07-11T09:00:00Z"),
                      OffsetDateTime.parse("2026-07-11T10:00:00Z"),
                      false,
                      null,
                      null,
                      null,
                      null,
                      null,
                      externalCalendarId); // 이동 대상 = 읽기전용 컨테이너
              assertThatThrownBy(
                      () -> eventService.update(ownerId, localEventId, req, EditScope.ALL, null))
                  .isInstanceOf(ReadOnlyCalendarException.class);
              return null;
            });
  }

  /** 로컬(읽기전용 아님) 이벤트 수정은 가드에 막히지 않는다 — 오발동 회귀 확인. */
  @Test
  void localEvent_stillEditable() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              status.setRollbackOnly();
              CalendarEventRequest req =
                  new CalendarEventRequest(
                      "로컬 수정",
                      null,
                      OffsetDateTime.parse("2026-07-11T09:00:00Z"),
                      OffsetDateTime.parse("2026-07-11T10:00:00Z"),
                      false,
                      null,
                      null,
                      null,
                      null,
                      null,
                      null);
              assertThatCode(
                      () -> eventService.update(ownerId, localEventId, req, EditScope.ALL, null))
                  .doesNotThrowAnyException();
              return null;
            });
  }

  /**
   * M365_GRAPH OAuth email_account 픽스처 생성.
   *
   * <p>calendar.external_account_id FK 충족을 위해 실제 행을 삽입한다.
   */
  private long seedGraphAccount(long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "readonly-guard-test-" + userId + "@test.local")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "읽기전용 가드 테스트 계정")
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
