package com.workplace.calendar;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.CALENDAR_EVENT_NOTE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.WIKI_PAGE;
import static com.workplace.jooq.Tables.WIKI_SPACE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V305 calendar_event_note RLS 격리(WP-1701): 테넌트 2 의 연결은 테넌트 1 컨텍스트에서 비가시이고, 다른 테넌트 id 로는 삽입할 수 없다.
 * 롤백되는 단일 트랜잭션으로 수행(CalendarDomainRlsTest 패턴).
 */
class CalendarEventNoteRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  @Test
  void otherTenant_cannotSeeOrInsert() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-note-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-NOTE")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();
              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long ownerId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-note-" + suffix)
                      .set(USER.NAME, "RLS Note Owner")
                      .set(USER.EMAIL, "rls-note-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              setGuc(tid2);
              OffsetDateTime now = OffsetDateTime.now();
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
              Long spaceId =
                  dsl.insertInto(WIKI_SPACE)
                      .set(WIKI_SPACE.NAME, "rls-space")
                      .set(WIKI_SPACE.TYPE, "TEAM")
                      .set(WIKI_SPACE.OWNER_ID, ownerId)
                      .set(WIKI_SPACE.TENANT_ID, tid2)
                      .returning(WIKI_SPACE.ID)
                      .fetchOne()
                      .getId();
              Long pageId =
                  dsl.insertInto(WIKI_PAGE)
                      .set(WIKI_PAGE.SPACE_ID, spaceId)
                      .set(WIKI_PAGE.TITLE, "rls-page")
                      .set(WIKI_PAGE.POSITION, 0)
                      .set(WIKI_PAGE.TENANT_ID, tid2)
                      .returning(WIKI_PAGE.ID)
                      .fetchOne()
                      .getId();
              Long noteId =
                  dsl.insertInto(CALENDAR_EVENT_NOTE)
                      .set(CALENDAR_EVENT_NOTE.EVENT_ID, eventId)
                      .set(CALENDAR_EVENT_NOTE.WIKI_PAGE_ID, pageId)
                      .set(CALENDAR_EVENT_NOTE.TENANT_ID, tid2)
                      .returning(CALENDAR_EVENT_NOTE.ID)
                      .fetchOne()
                      .getId();
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CALENDAR_EVENT_NOTE)
                              .where(CALENDAR_EVENT_NOTE.ID.eq(noteId))))
                  .isEqualTo(1);

              // 테넌트 1 컨텍스트 — 테넌트 2 의 연결은 0건
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(CALENDAR_EVENT_NOTE)
                              .where(CALENDAR_EVENT_NOTE.ID.eq(noteId))))
                  .isZero();
              status.setRollbackOnly();
              return null;
            });
  }

  /** 앱 롤(app_tenant) 로 다른 테넌트 id 를 박아 넣으면 정책(WITH CHECK) 위반이다. */
  @Test
  void insertWithForeignTenantId_violatesPolicy() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(1L);
              assertThatThrownBy(
                      () ->
                          dsl.insertInto(CALENDAR_EVENT_NOTE)
                              .set(CALENDAR_EVENT_NOTE.EVENT_ID, 1L)
                              .set(CALENDAR_EVENT_NOTE.WIKI_PAGE_ID, 1L)
                              .set(CALENDAR_EVENT_NOTE.TENANT_ID, 999_999L)
                              .execute())
                  .rootCause()
                  .hasMessageContaining("row-level security");
              status.setRollbackOnly();
              return null;
            });
  }
}
