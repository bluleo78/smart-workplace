package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.CALENDAR;
import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.calendar.dto.CalendarRequest;
import com.workplace.calendar.exception.ExternalCalendarDeletionNotAllowedException;
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
 * 외부 동기화 캘린더(accountEmail 보유) 로컬 삭제 거부 통합 테스트 (#608).
 *
 * <p>Graph 상 canEdit=true(is_read_only=false)인 사용자 기본 메일함 캘린더도, external_account_id 를 갖는 외부 동기화
 * 컨테이너라면 로컬 삭제를 거부해야 한다 — 삭제해도 다음 동기화 사이클에서 신규 calendar_id 로 재생성되어 중복/고아 데이터가 발생하기 때문이다.
 */
class CalendarDeleteExternalTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired EncryptionService encryption;
  @Autowired ExternalCalendarRepository extRepo;
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

  /** 쓰기 가능(canEdit=true → is_read_only=false) 외부 동기화 캘린더 삭제 → 409, 캘린더 존속(#608 핵심 케이스). */
  @Test
  void delete_writableExternalCalendar_isRejected() {
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
                  new ExternalEventRow("외부", null, S, S.plusHours(1), false, null, null));

              assertThatThrownBy(() -> calendarService.delete(ownerId, ext))
                  .isInstanceOf(ExternalCalendarDeletionNotAllowedException.class);

              assertThat(dsl.fetchExists(dsl.selectFrom(CALENDAR).where(CALENDAR.ID.eq(ext))))
                  .isTrue();
              status.setRollbackOnly();
              return null;
            });
  }

  /** 읽기전용 외부 동기화 캘린더 삭제 → 기존 ReadOnlyCalendarException 409 (회귀 확인, isExternal 체크보다 먼저 걸림). */
  @Test
  void delete_readOnlyExternalCalendar_stillRejectedAsReadOnly() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ext =
                  extRepo.upsertExternalCalendar(ownerId, accountId, "ext-ro", "공휴일", "blue", true);

              assertThatThrownBy(() -> calendarService.delete(ownerId, ext))
                  .isInstanceOf(ReadOnlyCalendarException.class);

              assertThat(dsl.fetchExists(dsl.selectFrom(CALENDAR).where(CALENDAR.ID.eq(ext))))
                  .isTrue();
              status.setRollbackOnly();
              return null;
            });
  }

  /** 로컬(비동기화) 캘린더 삭제는 계속 허용 — 회귀 방지. */
  @Test
  void delete_localCalendar_isStillAllowed() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long local =
                  calendarService.create(ownerId, new CalendarRequest("업무", "blue", null)).id();

              calendarService.delete(ownerId, local);

              assertThat(dsl.fetchExists(dsl.selectFrom(CALENDAR).where(CALENDAR.ID.eq(local))))
                  .isFalse();
              status.setRollbackOnly();
              return null;
            });
  }

  private long seedGraphAccount(long userId) {
    return dsl.insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "delete-test-" + userId + "@test.local")
        .set(EMAIL_ACCOUNT.DISPLAY_NAME, "삭제 테스트 계정")
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
