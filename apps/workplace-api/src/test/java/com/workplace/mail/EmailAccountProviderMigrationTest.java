package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.mail.dto.EmailAccountResponse;
import com.workplace.mail.dto.MailProvider;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V90 마이그레이션 검증: 기존 IMAP 계정 행은 provider 기본값 'IMAP' 으로 적재되고, EmailAccountResponse.provider() 가
 * MailProvider.IMAP 을 반환한다. 전체 단일 트랜잭션 + 롤백으로 공유 DB 무오염.
 */
class EmailAccountProviderMigrationTest extends IntegrationTestBase {

  @Autowired private EmailAccountRepository accountRepo;
  @Autowired private PlatformTransactionManager txManager;

  /**
   * 테스트 격리용 IMAP 계정 시드. provider 컬럼 미지정(기본값 'IMAP') → 기존 계정 동작 재현.
   *
   * @return 생성된 account id
   */
  private long seedImapAccount(long userId, long tenantId) {
    // provider 미지정 → DEFAULT 'IMAP' 자동 적용
    return baseDsl
        .insertInto(EMAIL_ACCOUNT)
        .set(EMAIL_ACCOUNT.USER_ID, userId)
        .set(EMAIL_ACCOUNT.EMAIL_ADDRESS, "imap-seed-" + UUID.randomUUID() + "@example.com")
        .set(EMAIL_ACCOUNT.IMAP_HOST, "imap.example.com")
        .set(EMAIL_ACCOUNT.IMAP_PORT, 993)
        .set(EMAIL_ACCOUNT.IMAP_SECURITY, "SSL_TLS")
        .set(EMAIL_ACCOUNT.IMAP_USERNAME, "user@example.com")
        .set(EMAIL_ACCOUNT.SMTP_HOST, "smtp.example.com")
        .set(EMAIL_ACCOUNT.SMTP_PORT, 465)
        .set(EMAIL_ACCOUNT.SMTP_SECURITY, "SSL_TLS")
        .set(EMAIL_ACCOUNT.SMTP_USERNAME, "user@example.com")
        .set(EMAIL_ACCOUNT.ENCRYPTED_PASSWORD, "enc-placeholder")
        .set(EMAIL_ACCOUNT.TENANT_ID, tenantId)
        .returning(EMAIL_ACCOUNT.ID)
        .fetchOne()
        .getId();
  }

  @Test
  void existingAccount_defaultsToImapProvider() {
    // GUC + 롤백 격리로 공유 DB 무오염
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              status.setRollbackOnly();

              // 테스트 전용 테넌트 생성
              String suffix = UUID.randomUUID().toString().substring(0, 8);
              Long tenantId =
                  baseDsl
                      .insertInto(TENANT)
                      .set(TENANT.SLUG, "mail-prov-test-" + suffix)
                      .set(TENANT.NAME, "MailProvTest-" + suffix)
                      .set(TENANT.STATUS, "ACTIVE")
                      .returning(TENANT.ID)
                      .fetchOne()
                      .getId();

              // 테스트 전용 사용자 생성
              Long userId =
                  baseDsl
                      .insertInto(USER)
                      .set(USER.USERNAME, "mail-prov-" + suffix)
                      .set(USER.NAME, "MailProvUser")
                      .set(USER.EMAIL, "mail-prov-" + suffix + "@example.com")
                      .set(USER.KIND, "HUMAN")
                      .returning(USER.ID)
                      .fetchOne()
                      .getId();

              // GUC 설정 후 계정 시드 (provider 미지정 → DEFAULT 'IMAP')
              baseDsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
              long accountId = seedImapAccount(userId, tenantId);

              // 조회 및 검증: provider() == MailProvider.IMAP
              EmailAccountResponse acc =
                  accountRepo.findByIdAndUser(userId, accountId).orElseThrow();
              assertThat(acc.provider()).isEqualTo(MailProvider.IMAP);

              return null;
            });
  }
}
