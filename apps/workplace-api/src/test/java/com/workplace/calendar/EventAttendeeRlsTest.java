package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EVENT_ATTENDEE;
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
 * V89 event_attendee 테이블 RLS 격리 증명: phantom 테넌트(tid2)가 삽입한 참석자 행은 tenant#1 GUC 컨텍스트에서 비가시. 단일 트랜잭션
 * 내에서 롤백하여 공유 DB 무오염. CalendarDomainRlsTest 패턴을 미러함.
 */
class EventAttendeeRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  /** 다른 테넌트가 만든 참석자 행은 현재 테넌트에서 보이지 않는다(PHANTOM). */
  @Test
  void eventAttendee_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              // 신규 phantom 테넌트 생성(같은 트랜잭션 내 FK 대상)
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-attendee-" + suffix)
                      .set(TENANT.NAME, "phantom")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트로 전환
              dsl.execute("SELECT set_config('app.tenant_id', '" + tid2 + "', true)");

              // tid2 컨텍스트에서 이벤트 + 참석자 삽입(tenant_id 명시)
              // #512: 빈 DB 에서도 동작하도록 소유자 USER 를 직접 시드(USER 는 RLS 비대상, 트랜잭션과 함께 롤백).
              Long ownerId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-attendee-owner-" + suffix)
                      .set(USER.PASSWORD, "pw")
                      .set(USER.NAME, "owner")
                      .set(USER.EMAIL, "rls-attendee-owner-" + suffix + "@example.com")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();
              // V104 NOT NULL: calendar_id 필수 — tid2 GUC 컨텍스트에서 기본 캘린더를 직접 삽입.
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
                      .set(CALENDAR_EVENT.TITLE, "phantom-evt")
                      .set(CALENDAR_EVENT.STARTS_AT, OffsetDateTime.now())
                      .set(CALENDAR_EVENT.ENDS_AT, OffsetDateTime.now().plusHours(1))
                      .set(CALENDAR_EVENT.TENANT_ID, tid2)
                      .set(CALENDAR_EVENT.CALENDAR_ID, calendarId)
                      .returning(CALENDAR_EVENT.ID)
                      .fetchOne()
                      .getId();

              dsl.insertInto(EVENT_ATTENDEE)
                  .set(EVENT_ATTENDEE.EVENT_ID, eventId)
                  .set(EVENT_ATTENDEE.USER_ID, ownerId)
                  .set(EVENT_ATTENDEE.ROLE, "ORGANIZER")
                  .set(EVENT_ATTENDEE.RSVP_STATUS, "ACCEPTED")
                  .set(EVENT_ATTENDEE.TENANT_ID, tid2)
                  .execute();

              // tid2 컨텍스트에서는 1건 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EVENT_ATTENDEE)
                              .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트로 전환 → 비가시(RLS USING 차단)
              dsl.execute("SELECT set_config('app.tenant_id', '1', true)");
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EVENT_ATTENDEE)
                              .where(EVENT_ATTENDEE.EVENT_ID.eq(eventId))))
                  .isEqualTo(0);

              status.setRollbackOnly(); // 공유 DB 무오염
            });
  }
}
