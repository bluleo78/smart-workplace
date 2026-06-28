package com.workplace.calendar.repository;

import static com.workplace.jooq.Tables.CALENDAR_EVENT;
import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * ExternalCalendarRepository 통합 테스트.
 *
 * <p>외부 일정 upsert 멱등성(같은 external_id → 같은 행 갱신)과 prune(keep 집합 외 삭제)를 검증한다. email_account FK 충족을 위해
 * 실제 email_account 행을 삽입한다.
 *
 * <p>RLS(FORCE) 통과를 위해 TenantContext + TransactionTemplate 패턴을 사용하고, setRollbackOnly 로 공유 DB를 오염시키지
 * 않는다.
 */
class ExternalCalendarRepositoryTest extends IntegrationTestBase {

  @Autowired private ExternalCalendarRepository repo;
  @Autowired private DSLContext dsl;

  /** 테스트에서 사용할 테넌트 id (시드 데이터 tenant#1). */
  private static final long TENANT_ID = 1L;

  @BeforeEach
  void setUp() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  /**
   * email_account 픽스처 생성.
   *
   * <p>calendar.external_account_id FK(→ email_account.id) 충족을 위해 실제 행을 삽입한다. AI_ENABLED 기본값 false,
   * PROVIDER 기본값 'IMAP'.
   *
   * @param userId email_account.user_id
   * @return email_account.id
   */
  private long emailAccount(long userId) {
    long nano = System.nanoTime();
    return dsl.insertInto(
            EMAIL_ACCOUNT,
            EMAIL_ACCOUNT.USER_ID,
            EMAIL_ACCOUNT.EMAIL_ADDRESS,
            EMAIL_ACCOUNT.TENANT_ID,
            EMAIL_ACCOUNT.AI_ENABLED)
        .values(userId, "ext-cal-test-" + nano + "@test.local", TENANT_ID, false)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  /** 테스트용 샘플 일정 행. */
  private ExternalCalendarRepository.ExternalEventRow sampleRow() {
    return new ExternalCalendarRepository.ExternalEventRow(
        "샘플 일정",
        null,
        OffsetDateTime.parse("2026-07-01T01:00:00Z"),
        OffsetDateTime.parse("2026-07-01T02:00:00Z"),
        false,
        null);
  }

  /**
   * DSLContext 로 calendar_event 제목 직접 조회.
   *
   * <p>titleOf 는 테스트 보조 — 생산 코드 노출 없이 DSL 직접 조회.
   */
  private String titleOf(long eventId) {
    return dsl.select(CALENDAR_EVENT.TITLE)
        .from(CALENDAR_EVENT)
        .where(CALENDAR_EVENT.ID.eq(eventId))
        .fetchOne(CALENDAR_EVENT.TITLE);
  }

  /**
   * DSLContext 로 calendar_event 존재 여부 확인.
   *
   * <p>existsById 는 테스트 보조 — 생산 코드 노출 없이 DSL 직접 조회.
   */
  private boolean existsById(long eventId) {
    return dsl.fetchExists(CALENDAR_EVENT, CALENDAR_EVENT.ID.eq(eventId));
  }

  /** 같은 external_id 로 두 번 upsert 시 같은 행 id 를 반환하고 제목이 갱신된다. */
  @Test
  void upsertExternalEvent_isIdempotent_onSameExternalId() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ownerId = TestFixtures.createHuman(dsl);
              long accountId = emailAccount(ownerId);

              long calId =
                  repo.upsertExternalCalendar(ownerId, accountId, "graphCal1", "업무", "blue");

              var row =
                  new ExternalCalendarRepository.ExternalEventRow(
                      "회의",
                      null,
                      OffsetDateTime.parse("2026-07-01T01:00:00Z"),
                      OffsetDateTime.parse("2026-07-01T02:00:00Z"),
                      false,
                      "회의실");
              long first = repo.upsertExternalEvent(ownerId, calId, "graphEvt1", row);

              var row2 =
                  new ExternalCalendarRepository.ExternalEventRow(
                      "회의(수정)", null, row.startsAt(), row.endsAt(), false, "회의실B");
              long second = repo.upsertExternalEvent(ownerId, calId, "graphEvt1", row2);

              // 같은 행 갱신 — id 는 동일
              assertThat(second).isEqualTo(first);
              // 제목이 갱신됐는지 직접 확인
              assertThat(titleOf(first)).isEqualTo("회의(수정)");

              status.setRollbackOnly();
              return null;
            });
  }

  /** pruneEventsNotIn 은 keep 집합에 없는 external_id 를 가진 일정만 삭제한다. */
  @Test
  void pruneEventsNotIn_deletes_only_missing() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              long ownerId = TestFixtures.createHuman(dsl);
              long accountId = emailAccount(ownerId);

              long calId = repo.upsertExternalCalendar(ownerId, accountId, "c", "업무", "blue");
              long keep = repo.upsertExternalEvent(ownerId, calId, "keep", sampleRow());
              long gone = repo.upsertExternalEvent(ownerId, calId, "gone", sampleRow());

              int deleted = repo.pruneEventsNotIn(calId, Set.of("keep"));

              assertThat(deleted).isEqualTo(1);
              assertThat(existsById(keep)).isTrue();
              assertThat(existsById(gone)).isFalse();

              status.setRollbackOnly();
              return null;
            });
  }
}
