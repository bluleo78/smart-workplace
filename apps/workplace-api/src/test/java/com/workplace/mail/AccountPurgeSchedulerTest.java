package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.service.AccountPurgeScheduler;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** purge 스케줄러가 비활성 계정만 물리 삭제하고 활성 계정은 보존하는지 검증. */
class AccountPurgeSchedulerTest extends IntegrationTestBase {

  @Autowired DSLContext dsl;
  @Autowired AccountPurgeScheduler scheduler;
  @Autowired org.springframework.transaction.PlatformTransactionManager txManager;

  @AfterEach
  void tearDown() {
    TenantContext.clear();
  }

  @Test
  @DisplayName("purgeAllTenants 는 비활성 계정을 삭제하고 활성 계정은 남긴다")
  void purgeAllTenants_deletesDisabledKeepsActive() {
    var tx = new org.springframework.transaction.support.TransactionTemplate(txManager);

    // 셋업은 commit 트랜잭션(GUC 주입). 스케줄러는 자체 tx 에서 이 행을 본다.
    TenantContext.set(1L);
    long[] ids =
        tx.execute(
            status -> {
              long owner = TestFixtures.createHuman(dsl);
              return new long[] {
                owner, insertAccount(owner, null), insertAccount(owner, OffsetDateTime.now())
              };
            });
    long owner = ids[0], active = ids[1], disabled = ids[2];
    TenantContext.clear();

    // 스케줄러는 요청 밖 — 내부에서 테넌트별 TenantContext.set 한다.
    scheduler.purgeAllTenants();

    TenantContext.set(1L);
    tx.executeWithoutResult(
        status -> {
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne().from(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(disabled))))
              .as("비활성 계정 purge 삭제")
              .isFalse();
          assertThat(
                  dsl.fetchExists(
                      dsl.selectOne().from(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(active))))
              .as("활성 계정 보존")
              .isTrue();
        });

    // owner 삭제 → cascade 로 active 계정 등 정리(테스트 DB 누적 방지).
    cleanupInTenant(
        1L,
        () ->
            dsl.deleteFrom(com.workplace.jooq.Tables.USER)
                .where(com.workplace.jooq.Tables.USER.ID.eq(owner))
                .execute());
  }

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
}
