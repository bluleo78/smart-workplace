package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_ATTACHMENT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.support.IntegrationTestBase;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V59 mail 도메인 RLS 격리 증명: tenant#2 의 email_account/folder/message/attachment 가 tenant#1 GUC 컨텍스트에서
 * 비가시. 더불어 email_account 유니크(uq_email_account_user_addr)가 테넌트별로 동작해 두 테넌트가 같은 (user, 주소) 계정을 생성할 수
 * 있음을 확인한다. 전체 단일 트랜잭션 + 롤백 → 공유 DB 무오염.
 */
class MailDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 현재 GUC 컨텍스트에 email_account → folder → message → attachment 체인을 삽입하고 messageId 반환. */
  private long insertMailChain(long tenantId, long userId, String address) {
    Long accountId =
        dsl.insertInto(EMAIL_ACCOUNT)
            .set(EMAIL_ACCOUNT.USER_ID, userId)
            .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, address)
            .set(EMAIL_ACCOUNT.IMAP_HOST, "imap.x")
            .set(EMAIL_ACCOUNT.IMAP_PORT, 993)
            .set(EMAIL_ACCOUNT.IMAP_SECURITY, "SSL_TLS")
            .set(EMAIL_ACCOUNT.IMAP_USERNAME, address)
            .set(EMAIL_ACCOUNT.SMTP_HOST, "smtp.x")
            .set(EMAIL_ACCOUNT.SMTP_PORT, 465)
            .set(EMAIL_ACCOUNT.SMTP_SECURITY, "SSL_TLS")
            .set(EMAIL_ACCOUNT.SMTP_USERNAME, address)
            .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, "enc")
            .set(EMAIL_ACCOUNT.TENANT_ID, tenantId)
            .returning(EMAIL_ACCOUNT.ID)
            .fetchOne()
            .getId();
    Long folderId =
        dsl.insertInto(EMAIL_FOLDER)
            .set(EMAIL_FOLDER.ACCOUNT_ID, accountId)
            .set(EMAIL_FOLDER.NAME, "INBOX")
            .set(EMAIL_FOLDER.TENANT_ID, tenantId)
            .returning(EMAIL_FOLDER.ID)
            .fetchOne()
            .getId();
    Long messageId =
        dsl.insertInto(EMAIL_MESSAGE)
            .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
            .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
            .set(EMAIL_MESSAGE.IMAP_UID, 1L)
            .set(EMAIL_MESSAGE.THREAD_ID, "thread-1")
            .set(EMAIL_MESSAGE.TENANT_ID, tenantId)
            .returning(EMAIL_MESSAGE.ID)
            .fetchOne()
            .getId();
    dsl.insertInto(EMAIL_ATTACHMENT)
        .set(EMAIL_ATTACHMENT.MESSAGE_ID, messageId)
        .set(EMAIL_ATTACHMENT.FILENAME, "a.txt")
        .set(EMAIL_ATTACHMENT.TENANT_ID, tenantId)
        .execute();
    return messageId;
  }

  @Test
  void mailTables_areIsolatedAndUniquePerTenant() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 =
                  dsl.insertInto(TENANT)
                      .set(TENANT.SLUG, "rls-mail-" + System.nanoTime())
                      .set(TENANT.NAME, "RLS-MAIL")
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              String suffix = String.valueOf(System.nanoTime() % 1_000_000);
              Long userId =
                  dsl.insertInto(USER)
                      .set(USER.USERNAME, "rls-mail-" + suffix)
                      .set(USER.NAME, "RLS Mail User")
                      .set(USER.EMAIL, "rls-mail-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              String sharedAddr = "shared-" + suffix + "@example.com";

              // 같은 (user, 주소)로 두 테넌트가 각각 계정 생성 — 유니크가 테넌트별이므로 충돌하지 않아야 한다.
              setGuc(1L);
              long msg1 = insertMailChain(1L, userId, sharedAddr);
              setGuc(tid2);
              // 같은 (user, 주소) 계정 체인을 tid2 컨텍스트에서 생성 — 유니크가 테넌트별이라 충돌 없이 성공해야 함.
              long msg2 = insertMailChain(tid2, userId, sharedAddr);

              // tid2 컨텍스트: 자기 메시지만 가시, tenant#1 메시지는 비가시
              final long fMsg1 = msg1;
              final long fMsg2 = msg2;
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(fMsg2))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(fMsg1))))
                  .isZero();
              // 첨부도 tid2 컨텍스트에서 tenant#1 행 비가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EMAIL_ATTACHMENT)
                              .where(EMAIL_ATTACHMENT.MESSAGE_ID.eq(fMsg1))))
                  .isZero();

              // tenant#1 컨텍스트: 반대로 자기 메시지만 가시
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(fMsg1))))
                  .isEqualTo(1);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(EMAIL_MESSAGE).where(EMAIL_MESSAGE.ID.eq(fMsg2))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }
}
