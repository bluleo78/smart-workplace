package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.BodyTarget;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.mail.service.MailBodyFetcher;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * Task 4: MailBackfillService 의 @Async 경로 GUC 전파 검증 — backfillNow 가 명시적
 * TransactionTemplate(@Primary TenantAwareTransactionManager)으로 트랜잭션을 열어, 워커 스레드에 복원된 TenantContext
 * 가 GUC(app.tenant_id)로 주입됨을 증명한다. (하버스 세션 GUC=1 에 의존하지 않도록, 시드를 일부러 두 번째 테넌트(tid2)에 두고
 * TenantContext=tid2 로 호출 — GUC 주입이 안 되면 fail-closed 로 0건이 되어 fetchBody 가 호출되지 않아 실패한다.)
 *
 * <p>@Transactional 절대 금지 — 외부 트랜잭션이 backfillNow 의 TransactionTemplate(REQUIRED)에 합류해 doBegin(GUC
 * 주입)이 발화하지 않으면 검증이 무력화된다. 커밋된 시드를 @AfterEach 에서 회수(email_account 삭제 시 folder/message CASCADE).
 */
class MailBackfillServiceTenantTest extends IntegrationTestBase {

  private static final String TENANT2_SLUG = "mail-backfill-tenant-2";

  @Autowired DSLContext dsl;
  @Autowired MailBackfillService backfillService;

  /** fetchBody 가 받은 대상(accountId)을 기록 — 실제 IMAP I/O 없이 GUC/스코프만 검증. */
  @MockitoBean MailBodyFetcher bodyFetcher;

  private final List<Long> fetchedAccountIds = new ArrayList<>();
  private Long account1;
  private Long account2;
  private Long user1;
  private Long user2;
  private long tid2;

  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(TENANT2_SLUG)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TENANT2_SLUG)
        .set(TENANT.NAME, "Mail Backfill Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private long seedUser() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "mbf_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U" + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 세션 GUC 컨텍스트에 계정+폴더+미적재 메시지(body_fetched_at NULL) 시드. accountId 반환. */
  private long seedAccountWithMissingBody(long userId, String addr) {
    long accountId =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, userId)
            .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, addr)
            .set(EMAIL_ACCOUNT.IMAP_HOST, "imap.x")
            .set(EMAIL_ACCOUNT.IMAP_PORT, 993)
            .set(EMAIL_ACCOUNT.IMAP_SECURITY, "SSL_TLS")
            .set(EMAIL_ACCOUNT.IMAP_USERNAME, addr)
            .set(EMAIL_ACCOUNT.SMTP_HOST, "smtp.x")
            .set(EMAIL_ACCOUNT.SMTP_PORT, 465)
            .set(EMAIL_ACCOUNT.SMTP_SECURITY, "SSL_TLS")
            .set(EMAIL_ACCOUNT.SMTP_USERNAME, addr)
            .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, "enc")
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, 1L)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-1")
        // body_fetched_at NULL → listMissingBody 대상
        .execute();
    return accountId;
  }

  @AfterEach
  void cleanup() {
    if (account1 != null) {
      setSessionGuc(1L);
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(account1)).execute();
      if (user1 != null) dsl.deleteFrom(USER).where(USER.ID.eq(user1)).execute();
    }
    if (account2 != null) {
      setSessionGuc(tid2);
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(account2)).execute();
      if (user2 != null) dsl.deleteFrom(USER).where(USER.ID.eq(user2)).execute();
    }
    setSessionGuc(1L);
    TenantContext.clear();
  }

  @Test
  void backfillNow_injectsTenantGuc_andStaysTenantScoped() {
    tid2 = ensureSecondTenant();

    // fetchBody 는 받은 대상의 accountId 를 기록만 한다(실 IMAP I/O 없음).
    doAnswer(
            inv -> {
              BodyTarget target = inv.getArgument(1);
              fetchedAccountIds.add(target.accountId());
              return null;
            })
        .when(bodyFetcher)
        .fetchBody(anyLong(), org.mockito.ArgumentMatchers.any());

    String run = UUID.randomUUID().toString().substring(0, 8);

    // tenant#1 미적재 계정 시드
    setSessionGuc(1L);
    user1 = seedUser();
    account1 = seedAccountWithMissingBody(user1, "u1-" + run + "@x.com");

    // tenant#2 미적재 계정 시드(세션 GUC 를 tid2 로 전환)
    setSessionGuc(tid2);
    user2 = seedUser();
    account2 = seedAccountWithMissingBody(user2, "u2-" + run + "@x.com");

    // 세션 GUC 를 하버스 기본값(1)으로 되돌린다 — 이제 backfillNow 가 자체 트랜잭션에서 GUC 를 주입하지 않으면
    // tid2 데이터는 fail-closed 로 0건이 되어야 한다(이 테스트가 GUC 주입을 강제로 증명).
    setSessionGuc(1L);

    // TenantContext=tid2 로 backfillNow 호출 — TransactionTemplate.doBegin 이 GUC=tid2 주입 → account2
    // 가시.
    TenantContext.set(tid2);
    backfillService.backfillNow(user2, account2);

    // tid2 의 account2 메시지 1건만 처리됨(account1 은 다른 테넌트라 비가시·미처리).
    assertThat(fetchedAccountIds).containsExactly(account2);
  }
}
