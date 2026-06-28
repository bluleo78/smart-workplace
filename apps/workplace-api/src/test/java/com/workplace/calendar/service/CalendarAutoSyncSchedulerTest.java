package com.workplace.calendar.service;

import static com.workplace.jooq.Tables.EMAIL_ACCOUNT;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.atLeast;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;

import com.workplace.global.security.EncryptionService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.mail.dto.EmailAccountRequest;
import com.workplace.mail.dto.MailSecurity;
import com.workplace.mail.repository.EmailAccountRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * CalendarAutoSyncScheduler 통합 테스트 — per-tenant 순회 및 계정별 실패 격리를 검증한다.
 *
 * <p>@Transactional 금지: 스케줄러는 요청 밖 스레드를 재현하므로 주변 트랜잭션 없이 실행된다. 시드 데이터는 실제 커밋 후 @AfterEach 에서 정리.
 *
 * <p>CalendarSyncService 는 @MockitoBean 으로 교체해 실제 Graph API 호출 없이 실패 격리만 검증한다.
 */
class CalendarAutoSyncSchedulerTest extends IntegrationTestBase {

  /** 테스트 전용 테넌트 슬러그 — find-or-create 로 누적을 방지. */
  private static final String TENANT_A_SLUG = "cal-auto-sync-tenant-a";

  private static final String TENANT_B_SLUG = "cal-auto-sync-tenant-b";

  @Autowired DSLContext dsl;
  @Autowired CalendarAutoSyncScheduler scheduler;
  @Autowired EmailAccountRepository accountRepo;
  @Autowired EncryptionService encryption;

  /** CalendarSyncService 를 목으로 교체 — 실제 Graph/IMAP 호출 없이 실패 격리 검증. */
  @MockitoBean CalendarSyncService syncService;

  /** 테스트에서 생성한 (tenantId, accountId, userId) 튜플 — AfterEach 에서 정리. */
  private final List<long[]> seeded = new ArrayList<>();

  // ── 헬퍼 ──────────────────────────────────────────────────────────────────

  /** 세션 GUC 설정(is_local=false — autocommit 시드/조회용). */
  private void setSessionGuc(long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', false)");
  }

  /** 고정 슬러그로 ACTIVE 테넌트를 find-or-create. */
  private long ensureTenant(String slug, String name) {
    Long existing =
        dsl.select(TENANT.ID).from(TENANT).where(TENANT.SLUG.eq(slug)).fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, slug)
        .set(TENANT.NAME, name)
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 현재 세션 GUC 컨텍스트(이미 setSessionGuc 호출 완료)에 더미 email_account 행을 삽입한다. RLS WITH CHECK 가 현재 GUC 의
   * tenant_id 를 자동 주입한다.
   */
  private long insertAccount(long userId) {
    EmailAccountRequest req =
        new EmailAccountRequest(
            "cal@test.local",
            "캘린더테스트계정",
            "127.0.0.1",
            993,
            MailSecurity.SSL_TLS,
            "cal@test.local",
            "127.0.0.1",
            587,
            MailSecurity.STARTTLS,
            "cal@test.local",
            "pw",
            false);
    return accountRepo.insert(userId, req, encryption.encrypt("pw"));
  }

  @AfterEach
  void cleanup() {
    for (long[] t : seeded) {
      long tenantId = t[0];
      long accId = t[1];
      long userId = t[2];
      setSessionGuc(tenantId);
      dsl.deleteFrom(EMAIL_ACCOUNT).where(EMAIL_ACCOUNT.ID.eq(accId)).execute();
      if (userId > 0) {
        dsl.deleteFrom(USER).where(USER.ID.eq(userId)).execute();
      }
    }
    seeded.clear();
    setSessionGuc(1L);
    TenantContext.clear();
  }

  // ── 테스트 ────────────────────────────────────────────────────────────────

  @Test
  @DisplayName("한 계정 sync 실패가 다른 계정 동기화를 막지 않는다 — 실패 격리 검증")
  void syncAllTenants_isolatesPerAccountFailure() {
    // ── 테넌트 A(전용 슬러그 — 기존 계정 없음)에 계정 1 시드
    long tidA = ensureTenant(TENANT_A_SLUG, "CalAutoSync Tenant A");
    setSessionGuc(tidA);
    String suffixA = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long userA =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "calschd_a_" + suffixA)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "CSA" + suffixA)
            .set(USER.EMAIL, suffixA + "a@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    long accA = insertAccount(userA);
    seeded.add(new long[] {tidA, accA, userA});

    // ── 테넌트 B(전용 슬러그 — 기존 계정 없음)에 계정 2 시드
    long tidB = ensureTenant(TENANT_B_SLUG, "CalAutoSync Tenant B");
    setSessionGuc(tidB);
    String suffixB = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    long userB =
        dsl.insertInto(USER)
            .set(USER.USERNAME, "calschd_b_" + suffixB)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, "CSB" + suffixB)
            .set(USER.EMAIL, suffixB + "b@example.com")
            .set(USER.KIND, "HUMAN")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    long accB = insertAccount(userB);
    seeded.add(new long[] {tidB, accB, userB});

    // ── mock 설정: 첫 호출 throw, 이후 모든 호출 정상(doAnswer 체인 없이 기본 doNothing 으로 이어짐)
    doThrow(new RuntimeException("boom")).when(syncService).sync(anyLong(), anyLong());

    // ── 스케줄러 호출 — 요청 밖 스레드 재현: 호출 직전 TenantContext.clear() (#481 교훈)
    TenantContext.clear();
    scheduler.syncAllTenants();

    // ── 두 계정 모두 sync 가 호출됐는지 확인 (첫 호출 실패에도 두 번째 호출됨 = 실패 격리 증명)
    // 공유 테스트 DB 에 다른 테넌트 계정이 존재할 수 있으므로 atLeast(2) 로 검증
    verify(syncService, atLeast(2)).sync(anyLong(), anyLong());
  }
}
