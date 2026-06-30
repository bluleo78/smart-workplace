package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.service.EmailAccountService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.Duration;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정 삭제 직후 즉시 물리 purge production 경로 통합 (#555).
 *
 * <p>{@code EmailAccountService.delete()}(@Transactional)를 실제 호출 → 커밋 →
 * MailAccountDisconnectedEvent 의 AFTER_COMMIT 리스너({@code AccountPurgeDispatcher}) → @Async purge 까지
 * 전체 경로를 검증한다. 5분 주기 {@code AccountPurgeScheduler}(initialDelay 90s)를 기다리지 않고도 삭제 직후 계정이 물리 삭제되는지
 * 확인하는 회귀 가드 — 10초 윈도우 안의 삭제는 스케줄러가 발화할 수 없으므로 즉시 트리거의 증거가 된다.
 *
 * <p>이 클래스는 @Transactional 을 절대 붙이지 않는다 — 외부 트랜잭션 안에서는 AFTER_COMMIT 이 발화하지 않아 검증이 무력화된다(#476/#514
 * 교훈). 셋업은 커밋되는 TransactionTemplate(GUC 주입)으로 활성 계정을 만들고, tenant 는 ThreadLocal(TenantContext)로 주입
 * — @Async 워커에 decorator 가 전파해 purge 트랜잭션의 GUC 를 채운다.
 */
@DisplayName("계정 삭제 직후 → 커밋 → AFTER_COMMIT → 즉시 purge 통합 (#555)")
class AccountPurgeImmediateIntegrationTest extends IntegrationTestBase {

  @Autowired EmailAccountService emailAccountService;
  @Autowired DSLContext dsl;
  @Autowired PlatformTransactionManager txManager;

  private static final long TENANT_ID = 1L;
  private Long userId;
  private Long accountId;

  @BeforeEach
  void tenant() {
    TenantContext.set(TENANT_ID);
  }

  @AfterEach
  void cleanup() {
    TenantContext.set(TENANT_ID);
    // purge 가 계정을 이미 지웠으면 no-op. 실패로 남았으면 회수. user 삭제 → 잔여 계정 CASCADE.
    cleanupInTenant(
        TENANT_ID,
        () -> {
          if (accountId != null) {
            dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accountId)).execute();
          }
          if (userId != null) {
            dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
          }
        });
    userId = null;
    accountId = null;
    TenantContext.clear();
  }

  @Test
  @DisplayName("계정 삭제 직후 스케줄러 없이 즉시 물리 purge 된다")
  void delete_triggersImmediatePurgeAfterCommit() {
    // 셋업: 활성 계정 1건을 커밋(GUC 주입). 삭제 후 purge 가 이 행을 물리 삭제해야 한다.
    long[] ids =
        new TransactionTemplate(txManager)
            .execute(
                status -> {
                  long u = TestFixtures.createHuman(dsl);
                  long a =
                      dsl.insertInto(EMAIL_ACCOUNT)
                          .set(EMAIL_ACCOUNT.USER_ID, u)
                          .set(
                              EMAIL_ACCOUNT.EMAIL_ADDRESS, "purge-" + System.nanoTime() + "@ex.com")
                          .set(EMAIL_ACCOUNT.DISPLAY_NAME, "purge")
                          .set(EMAIL_ACCOUNT.PROVIDER, "M365_GRAPH")
                          .returning(EMAIL_ACCOUNT.ID)
                          .fetchOne()
                          .getId();
                  return new long[] {u, a};
                });
    userId = ids[0];
    accountId = ids[1];

    // production 경로: delete() 커밋 → AFTER_COMMIT → @Async 즉시 purge.
    emailAccountService.delete(userId, accountId);

    // 스케줄러(initialDelay 90s)는 이 윈도우에 발화 불가 → 계정 행이 사라지면 즉시 트리거가 동작한 것.
    final long accId = accountId;
    await()
        .atMost(Duration.ofSeconds(10))
        .untilAsserted(
            () ->
                new TransactionTemplate(txManager)
                    .executeWithoutResult(
                        status -> {
                          TenantContext.set(TENANT_ID);
                          assertThat(
                                  dsl.fetchExists(
                                      dsl.selectOne()
                                          .from(EMAIL_ACCOUNT)
                                          .where(EMAIL_ACCOUNT.ID.eq(accId))))
                              .as("삭제 직후 즉시 purge 로 계정 행이 물리 삭제됨")
                              .isFalse();
                        }));
  }
}
