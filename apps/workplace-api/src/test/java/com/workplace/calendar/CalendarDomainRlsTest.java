package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_EXCEPTION;
import static com.workplace.jooq.Tables.EVENT_REMINDER;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V59 calendar 도메인 RLS 격리 증명: tenant#2 의 calendar_event / event_reminder / calendar_event_exception
 * 이 tenant#1 GUC 컨텍스트에서 비가시. 전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염 (IssueDomainRlsTest 패턴).
 */
class CalendarDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  @Test
  void calendarTables_areIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              // 신규 테넌트(tid2) — 같은 트랜잭션 내 FK 대상(미커밋)
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-cal-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-CAL")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // calendar_event.owner_id 용 임시 user
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long ownerId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-cal-" + suffix)
                      .set(USER.NAME, "RLS Cal Owner")
                      .set(USER.EMAIL, "rls-cal-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트로 전환 후 calendar_event + 자식 삽입 (RLS WITH CHECK 통과)
              setGuc(tid2);
              OffsetDateTime now = OffsetDateTime.now();
              // V104 NOT NULL: calendar_id 필수 — tid2 컨텍스트(GUC)에서 기본 캘린더를 직접 삽입.
              Long calendarId =
                  dsl.insertInto(CALENDAR)
                      .set(CALENDAR.OWNER_ID, ownerId)
                      .set(CALENDAR.NAME, "기본")
                      .set(CALENDAR.COLOR, "blue")
                      .set(CALENDAR.IS_DEFAULT, true)
                      .set(CALENDAR.TENANT_ID, tid2)
                      .returning(CALENDAR.ID)
                      .fetchOne()
                      .getId();
              Long eventId =
                  dsl.insertInto(CALENDAR_EVENT)
                      .set(CALENDAR_EVENT.OWNER_ID, ownerId)
                      .set(CALENDAR_EVENT.TITLE, "rls-event")
                      .set(CALENDAR_EVENT.STARTS_AT, now)
                      .set(CALENDAR_EVENT.ENDS_AT, now.plusHours(1))
                      .set(CALENDAR_EVENT.TENANT_ID, tid2)
                      .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
                      .returning(CALENDAR_EVENT.ID)
                      .fetchOne()
                      .getId();

              Long reminderId =
                  dsl.insertInto(EVENT_REMINDER)
                      .set(EVENT_REMINDER.EVENT_ID, eventId)
                      .set(EVENT_REMINDER.LEAD_MINUTES, 10)
                      .set(EVENT_REMINDER.TENANT_ID, tid2)
                      .returning(EVENT_REMINDER.ID)
                      .fetchOne()
                      .getId();

              Long exceptionId =
                  dsl.insertInto(CALENDAR_EVENT_EXCEPTION)
                      .set(CALENDAR_EVENT_EXCEPTION.EVENT_ID, eventId)
                      .set(CALENDAR_EVENT_EXCEPTION.OCCURRENCE_DATE, now.plusDays(1))
                      .set(CALENDAR_EVENT_EXCEPTION.IS_CANCELLED, true)
                      .set(CALENDAR_EVENT_EXCEPTION.TENANT_ID, tid2)
                      .returning(CALENDAR_EVENT_EXCEPTION.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 모두 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eventId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EVENT_REMINDER).where(EVENT_REMINDER.ID.eq(reminderId))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CALENDAR_EVENT_EXCEPTION)
                              .where(CALENDAR_EVENT_EXCEPTION.ID.eq(exceptionId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트로 전환 → tid2 의 모든 행 비가시 (RLS USING 차단)
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CALENDAR_EVENT).where(CALENDAR_EVENT.ID.eq(eventId))))
                  .isZero();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EVENT_REMINDER).where(EVENT_REMINDER.ID.eq(reminderId))))
                  .isZero();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CALENDAR_EVENT_EXCEPTION)
                              .where(CALENDAR_EVENT_EXCEPTION.ID.eq(exceptionId))))
                  .isZero();

              status.setRollbackOnly(); // 공유 DB 무오염
              return null;
            });
  }
}
