package com.workplace.mail;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.icegreen.greenmail.configuration.GreenMailConfiguration;
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.GreenMailUtil;
import com.icegreen.greenmail.util.ServerSetupTest;
import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.mail.service.MailAutoSyncScheduler;
import com.workplace.mail.service.MailBackfillService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * MailAutoSyncScheduler 통합 테스트 — RLS-safe 멀티테넌트 폴링 및 실패 격리를 검증한다.
 *
 * <p>@Transactional 금지: sync 는 REQUIRES_NEW 짧은 트랜잭션으로 커밋하므로, 검증은 실제 커밋된 데이터를 대상으로 해야 한다.
 * 정리는 @AfterEach 에서 시드한 id 스코프로 삭제. 두 번째 테넌트는 고정 슬러그 find-or-create(app_tenant 롤은 tenant DELETE
 * 불가이므로).
 */
class MailAutoSyncSchedulerTest extends IntegrationTestBase {

  /** RLS 격리 증명용 존재하지 않는 테넌트 ID (app_tenant 롤은 tenant DELETE 불가이므로 INSERT 없이 사용). */
  private static final long PHANTOM_TENANT_ID = 999_999L;

  /** 두 번째 테넌트 고정 슬러그 — find-or-create 로 누적을 방지. */
  private static final String TENANT2_SLUG = "mail-auto-sync-tenant-2";

  @RegisterExtension
  static GreenMailExtension greenMail =
      new GreenMailExtension(ServerSetupTest.SMTP_IMAP)
          .withConfiguration(
              GreenMailConfiguration.aConfig().withUser("box@test.local", "box@test.local", "pw"));

  @Autowired DSLContext dsl;
  @Autowired MailAutoSyncScheduler scheduler;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;
  @Autowired PlatformTransactionManager txManager;

  /** 비동기 본문 보충 목킹 — sync 의 백필 트리거를 무동작으로 만들어 메타전용 단언을 결정적으로 만든다. */
  @MockitoBean MailBackfillService backfillService;

  /** 테스트에서 생성한 user/account id — AfterEach 에서 삭제 대상. (tenantId, accountId, userId) 튜플로 보관. */
  private final List<long[]> seeded = new ArrayList<>();

  /** 두 번째 테넌트 ID (find-or-create). */
  private Long tid2;

  // ── 헬퍼 ─────────────────────────────────────────────────────────────────

  /** 트랜잭션-로컬 GUC 설정 (is_local=true → tx 종료 시 자동 리셋). 트랜잭션 안에서만 호출해야 한다. */
  private void setGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }

  /** 세션 GUC 설정 (is_local=false → 세션 내내 유지). 트랜잭션 밖(autocommit) 시드/조회용. */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  /** 고정 슬러그로 두 번째 ACTIVE 테넌트를 find-or-create(RLS 없는 tenant 테이블에서). */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(TENANT2_SLUG)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TENANT2_SLUG)
        .set(TENANT.NAME, "Mail AutoSync Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * GreenMail(IMAP 3143)을 가리키는 계정을 현재 테넌트 컨텍스트에 삽입한다. GUC 세팅 후 insert 하면 RLS WITH CHECK 가 tenant_id
   * 자동 주입.
   */
  private long insertAccount(long userId) {
    return MailTestSupport.insertAccount(accountRepo, encryption, userId, false);
  }

  /** 지정 테넌트 컨텍스트에서 GreenMail 계정을 삽입한다. 세션 GUC 전환 후 삽입하므로 RLS WITH CHECK 가 해당 테넌트 ID를 주입. */
  private long insertAccountInTenant(long tenantId, long userId) {
    setSessionGuc(tenantId);
    long accId = MailTestSupport.insertAccount(accountRepo, encryption, userId, false);
    seeded.add(new long[] {tenantId, accId, userId});
    return accId;
  }

  /** 닿지 않는 IMAP 포트(port=1)로 계정을 삽입한다. 연결 시도 즉시 ECONNREFUSED 로 실패해 테스트가 블로킹되지 않는다. */
  private long insertAccountWithBadImapPort(long userId) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "bad@test.local",
            "불량계정",
            "127.0.0.1",
            1, // 반드시 닫힌 포트 → 즉시 ECONNREFUSED
            MailSecurity.NONE,
            "bad@test.local",
            "127.0.0.1",
            3025,
            MailSecurity.NONE,
            "bad@test.local",
            "pw",
            false);
    long accId = accountRepo.insert(userId, req, encryption.encrypt("pw"));
    // seeded 에는 tenant 1 계정으로 추가
    seeded.add(new long[] {1L, accId, userId});
    return accId;
  }

  /** 지정 테넌트 컨텍스트에 HUMAN user를 생성한다. 세션 GUC 전환 후 삽입. */
  private long createHumanInTenant(long tenantId) {
    setSessionGuc(tenantId);
    String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long userId =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "masync_" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "U" + suffix)
            .set(USER.EMAIL, suffix + "@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    return userId;
  }

  /** GreenMail 을 통해 box@test.local 로 메일 1통 전달. */
  private void deliverMessage(String subject) {
    GreenMailUtil.sendTextEmailTest("box@test.local", "sender@example.com", subject, "본문");
    greenMail.waitForIncomingEmail(1);
  }

  /** 주어진 tenantId GUC 하에서 accId 계정의 last_synced_at 을 조회한다. TransactionTemplate 로 안정적인 GUC 주입 보장. */
  private OffsetDateTime lastSyncedAtFor(long tenantId, long accId) {
    return new TransactionTemplate(txManager)
        .execute(
            status -> {
              setGuc(tenantId);
              return dsl.select(EMAIL_ACCOUNT.LAST_SYNCED_AT)
                  .from(EMAIL_ACCOUNT)
                  .where(EMAIL_ACCOUNT.ID.eq(accId))
                  .fetchOne(EMAIL_ACCOUNT.LAST_SYNCED_AT);
            });
  }

  @AfterEach
  void cleanup() {
    // seeded 튜플에서 각 테넌트 컨텍스트로 전환 후 email_account 삭제 → email_message CASCADE.
    // 이후 user 삭제. 순서: account → user (user 의 FK가 account 에 있으므로 account 먼저).
    for (long[] t : seeded) {
      long tenantId = t[0];
      long accId = t[1];
      long userId = t[2];
      setSessionGuc(tenantId);
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accId)).execute();
      dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
    }
    seeded.clear();
    // 세션 GUC 복원 — 후속 테스트 오염 방지
    setSessionGuc(1L);
    TenantContext.clear();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  @Test
  @DisplayName("스케줄러가 전 테넌트 활성 계정을 동기화하고 테넌트 간 RLS로 격리된다")
  void syncAllTenantsIsolatesByTenant() {
    // ── 테넌트 A (id=1) 계정 + 메일 시드
    setSessionGuc(1L);
    long userA = TestFixtures.createHuman(dsl);
    long accA = insertAccount(userA);
    seeded.add(new long[] {1L, accA, userA});
    deliverMessage("A-제목");

    // ── 테넌트 B (두 번째 테넌트) 계정 + 메일 시드
    tid2 = ensureSecondTenant();
    long userB = createHumanInTenant(tid2);
    long accB = insertAccountInTenant(tid2, userB);
    // GreenMail 은 단일 mailbox: box@test.local — IMAP 연결마다 현재 inbox 전체를 읽음
    deliverMessage("B-제목");

    // ── 스케줄러 호출 — 요청 밖 스레드 재현: 호출 직전 TenantContext.clear()
    TenantContext.clear();
    scheduler.syncAllTenants();

    // ── 테넌트 A 검증: last_synced_at 기록
    assertThat(lastSyncedAtFor(1L, accA)).as("테넌트 A accA last_synced_at 기록").isNotNull();

    // ── 테넌트 B 검증: last_synced_at 기록
    assertThat(lastSyncedAtFor(tid2, accB)).as("테넌트 B accB last_synced_at 기록").isNotNull();

    // ── PHANTOM 테넌트 GUC → EMAIL_ACCOUNT 0건 (RLS USING 격리)
    new TransactionTemplate(txManager)
        .executeWithoutResult(
            status -> {
              setGuc(PHANTOM_TENANT_ID);
              assertThat(dsl.fetchCount(EMAIL_ACCOUNT))
                  .as("PHANTOM 테넌트 GUC → email_account 0건(RLS 격리)")
                  .isZero();
            });
  }

  @Test
  @DisplayName("한 계정 동기화 실패가 다른 계정 폴링을 막지 않는다")
  void oneFailureDoesNotBlockOthers() {
    // ── 정상 계정 + 메일 시드
    setSessionGuc(1L);
    long userOk = TestFixtures.createHuman(dsl);
    long accOk = insertAccount(userOk);
    seeded.add(new long[] {1L, accOk, userOk});
    deliverMessage("OK-제목");

    // ── 불량 계정 시드 (port=1 → 즉시 ECONNREFUSED)
    long accBad = insertAccountWithBadImapPort(userOk);
    // accBad 의 userId 는 userOk 와 같으므로 seeded 에서 userId 중복 정리 피하기 위해 별도 acc 만 추적
    // insertAccountWithBadImapPort 가 이미 seeded 에 추가했으나 userId 가 userOk 와 같아 user 중복 삭제가 발생할 수 있음.
    // seeded 마지막 항목을 accBad-only 삭제(userId=0 마킹으로 user 삭제 스킵)로 교체.
    seeded.set(seeded.size() - 1, new long[] {1L, accBad, 0L});

    // ── 스케줄러 호출 — 요청 밖 스레드 재현
    TenantContext.clear();
    scheduler.syncAllTenants(); // 예외 전파 없이 완료해야 함

    // ── 정상 계정 last_synced_at 기록 확인 (불량 계정 실패에도 처리됨)
    assertThat(lastSyncedAtFor(1L, accOk))
        .as("정상 계정 last_synced_at 기록 — 불량 계정 실패가 블로킹하지 않음")
        .isNotNull();
  }
}
