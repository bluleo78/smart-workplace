package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.EMAIL_FOLDER;
import static com.workplace.jooq.Tables.EMAIL_MESSAGE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.MailSummaryResponse;
import com.workplace.mail.service.MailMessageService;
import com.workplace.support.IntegrationTestBase;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * #444 회귀 가드 — {@link MailMessageService#summary} 가 트랜잭션 경계 안에서 읽어 RLS GUC(app.tenant_id)를 주입함을
 * 증명한다.
 *
 * <p>버그: MeMailSummaryController 가 리포지토리를 트랜잭션 없이 직접 호출 → GUC 미주입 → RLS fail-closed 로 안읽음이 항상 0.
 *
 * <p>하버스 세션 GUC=1 마스킹 회피: 시드를 일부러 두 번째 테넌트(tid2)에 두고 세션 GUC 를 1 로 되돌린 뒤 TenantContext=tid2 로 호출한다.
 * summary 가 자체 트랜잭션({@code @Transactional})에서 GUC=tid2 를 주입하지 않으면 tid2 메일은 fail-closed(0건)가 되어 검증
 * 실패한다(= 버그 재현). {@link MailBackfillServiceTenantTest} 와 동일한 안전 패턴.
 *
 * <p><b>@Transactional 절대 금지</b> — 외부 트랜잭션이 summary 의 REQUIRED 에 합류하면 doBegin(GUC 주입)이 발화하지 않아 검증이
 * 무력화된다. 커밋된 시드는 @AfterEach 에서 자기-id 스코프로 회수(email_account 삭제 시 folder/message CASCADE).
 */
class MailSummaryServiceTenantTest extends IntegrationTestBase {

  private static final String TENANT2_SLUG = "mail-summary-tenant-2";

  @Autowired DSLContext dsl;
  @Autowired MailMessageService mailMessageService;

  private Long account2;
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
        .set(TENANT.NAME, "Mail Summary Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  private long seedUser() {
    String t = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "msum_" + t)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "U" + t)
        .set(USER.EMAIL, t + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 세션 GUC 컨텍스트에 계정+INBOX 폴더 시드. accountId 반환. */
  private long seedAccount(long userId, String addr) {
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
    Instant base = Instant.now().truncatedTo(ChronoUnit.SECONDS);
    // 안읽음 2건(최신순 검증용 시간차) + 읽음 1건(필터 제외 검증).
    seedMessage(accountId, folderId, 1L, "오래된 안읽음", false, base.minus(2, ChronoUnit.MINUTES));
    seedMessage(accountId, folderId, 2L, "최신 안읽음", false, base.minus(1, ChronoUnit.MINUTES));
    seedMessage(accountId, folderId, 3L, "읽음", true, base);
    return accountId;
  }

  private void seedMessage(
      long accountId, long folderId, long uid, String subject, boolean seen, Instant receivedAt) {
    dsl.insertInto(EMAIL_MESSAGE)
        .set(EMAIL_MESSAGE.ACCOUNT_ID, accountId)
        .set(EMAIL_MESSAGE.FOLDER_ID, folderId)
        .set(EMAIL_MESSAGE.IMAP_UID, uid)
        .set(EMAIL_MESSAGE.THREAD_ID, "thread-" + uid)
        .set(EMAIL_MESSAGE.SUBJECT, subject)
        .set(EMAIL_MESSAGE.SEEN, seen)
        .set(EMAIL_MESSAGE.RECEIVED_AT, receivedAt.atOffset(java.time.ZoneOffset.UTC))
        .execute();
  }

  @AfterEach
  void cleanup() {
    if (account2 != null) {
      setSessionGuc(tid2);
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(account2)).execute();
      if (user2 != null) dsl.deleteFrom(USER).where(USER.ID.eq(user2)).execute();
    }
    setSessionGuc(1L);
    TenantContext.clear();
  }

  @Test
  void summary_injectsTenantGuc_andCountsUnreadUnderNonDefaultTenant() {
    tid2 = ensureSecondTenant();

    // tenant#2 에 계정+안읽은 메일 시드(세션 GUC 를 tid2 로 전환 → tenant_id 가 GUC DEFAULT 로 tid2).
    setSessionGuc(tid2);
    user2 = seedUser();
    account2 = seedAccount(user2, "u2-" + UUID.randomUUID().toString().substring(0, 8) + "@x.com");

    // 세션 GUC 를 하버스 기본값(1)으로 되돌린다 — 이제 summary 가 자체 트랜잭션에서 GUC 를 주입하지 않으면
    // tid2 데이터는 fail-closed 로 0건이 되어야 한다(= 버그 재현, @Transactional 누락 시 실패).
    setSessionGuc(1L);

    // TenantContext=tid2 로 summary 호출 — @Transactional 의 doBegin 이 GUC=tid2 주입 → tid2 메일 가시.
    TenantContext.set(tid2);
    MailSummaryResponse res = mailMessageService.summary(user2, 5);

    // 안읽음 2건만 집계(읽음 제외), 최신순 정렬.
    assertThat(res.unreadCount()).isEqualTo(2);
    assertThat(res.recent()).hasSize(2);
    assertThat(res.recent().get(0).subject()).isEqualTo("최신 안읽음");
    assertThat(res.recent().get(0).seen()).isFalse();
    assertThat(res.recent().get(1).subject()).isEqualTo("오래된 안읽음");
  }
}
