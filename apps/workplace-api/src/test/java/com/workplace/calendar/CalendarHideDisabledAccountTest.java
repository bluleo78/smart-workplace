package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.calendar.repository.CalendarRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 비활성(soft-deleted) 메일 계정의 외부 캘린더/일정이 조회에서 숨겨지는지 검증. */
class CalendarHideDisabledAccountTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired CalendarRepository calendarRepo;
  @Autowired com.workplace.calendar.repository.CalendarEventRepository calendarEventRepo;
  @Autowired PlatformTransactionManager txManager;

  private static final long TENANT_ID = 1L;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("listByOwner 는 비활성 계정의 외부 캘린더를 제외하고 활성/로컬 캘린더만 반환한다")
  void listByOwner_excludesDisabledAccountCalendars() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long owner = TestFixtures.createHuman(dsl);
              long activeAcc = insertAccount(owner, null);
              long disabledAcc = insertAccount(owner, OffsetDateTime.now());

              long localCal = insertCalendar(owner, null, null);
              long activeExtCal = insertCalendar(owner, activeAcc, "ext-active");
              long disabledExtCal = insertCalendar(owner, disabledAcc, "ext-disabled");

              var ids = calendarRepo.listByOwner(owner).stream().map(c -> c.id()).toList();

              assertThat(ids).contains(localCal, activeExtCal);
              assertThat(ids).doesNotContain(disabledExtCal);

              assertThat(calendarRepo.findByIdForOwner(owner, disabledExtCal)).isEmpty();
              assertThat(calendarRepo.findByIdForOwner(owner, activeExtCal)).isPresent();

              status.setRollbackOnly();
            });
  }

  @Test
  @DisplayName("listByRange 는 비활성 계정 캘린더의 일정을 제외한다")
  void listByRange_excludesDisabledAccountEvents() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long owner = TestFixtures.createHuman(dsl);
              long disabledAcc = insertAccount(owner, OffsetDateTime.now());
              long disabledCal = insertCalendar(owner, disabledAcc, "ext-disabled");
              long localCal = insertCalendar(owner, null, null);

              var from = OffsetDateTime.parse("2026-06-01T00:00:00Z");
              var to = OffsetDateTime.parse("2026-07-01T00:00:00Z");
              long hiddenEvt = insertEvent(owner, disabledCal, from.plusDays(1), null);
              long shownEvt = insertEvent(owner, localCal, from.plusDays(2), null);

              var ids =
                  calendarEventRepo.listByRange(owner, from, to).stream().map(e -> e.id()).toList();
              assertThat(ids).contains(shownEvt);
              assertThat(ids).doesNotContain(hiddenEvt);

              status.setRollbackOnly();
            });
  }

  @Test
  @DisplayName("listRecurringMasters 는 비활성 계정 캘린더의 반복 마스터를 제외한다")
  void listRecurringMasters_excludesDisabledAccountMasters() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              long owner = TestFixtures.createHuman(dsl);
              long disabledAcc = insertAccount(owner, OffsetDateTime.now());
              long disabledCal = insertCalendar(owner, disabledAcc, "ext-disabled");
              long localCal = insertCalendar(owner, null, null);

              var start = OffsetDateTime.parse("2026-06-10T09:00:00Z");
              var to = OffsetDateTime.parse("2026-07-01T00:00:00Z");
              long hiddenMaster = insertEvent(owner, disabledCal, start, "FREQ=DAILY");
              long shownMaster = insertEvent(owner, localCal, start, "FREQ=DAILY");

              var ids =
                  calendarEventRepo.listRecurringMasters(owner, to).stream()
                      .map(e -> e.id())
                      .toList();
              assertThat(ids).contains(shownMaster);
              assertThat(ids).doesNotContain(hiddenMaster);

              status.setRollbackOnly();
            });
  }

  /** disabledAt 이 null 이면 활성, 값이 있으면 soft-deleted 계정. */
  private long insertAccount(long userId, OffsetDateTime disabledAt) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "acc-" + System.nanoTime() + "@example.com")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "acc")
        .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
        .set(EMAIL_ACCOUNT.DISABLED_AT, disabledAt)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  private long insertCalendar(long ownerId, Long externalAccountId, String externalId) {
    return dsl.insertInto(CALENDAR)
        .set(CALENDAR.OWNER_ID, ownerId)
        .set(CALENDAR.NAME, "cal")
        .set(CALENDAR.COLOR, "#3b82f6")
        .set(CALENDAR.IS_DEFAULT, false)
        .set(CALENDAR.POSITION, 0)
        .set(CALENDAR.EXTERNAL_ACCOUNT_ID, externalAccountId)
        .set(CALENDAR.EXTERNAL_ID, externalId)
        .returning(CALENDAR.ID)
        .fetchOne()
        .getId();
  }

  private long insertEvent(
      long ownerId, long calendarId, OffsetDateTime startsAt, String recurrenceRule) {
    return dsl.insertInto(com.workplace.jooq.Tables.CALENDAR_EVENT)
        .set(com.workplace.jooq.Tables.CALENDAR_EVENT.OWNER_ID, ownerId)
        .set(com.workplace.jooq.Tables.CALENDAR_EVENT.CALENDAR_ID, calendarId)
        .set(com.workplace.jooq.Tables.CALENDAR_EVENT.TITLE, "evt")
        .set(com.workplace.jooq.Tables.CALENDAR_EVENT.STARTS_AT, startsAt)
        .set(com.workplace.jooq.Tables.CALENDAR_EVENT.ENDS_AT, startsAt.plusHours(1))
        .set(com.workplace.jooq.Tables.CALENDAR_EVENT.ALL_DAY, false)
        .set(com.workplace.jooq.Tables.CALENDAR_EVENT.RECURRENCE_RULE, recurrenceRule)
        .returning(com.workplace.jooq.Tables.CALENDAR_EVENT.ID)
        .fetchOne()
        .getId();
  }
}
