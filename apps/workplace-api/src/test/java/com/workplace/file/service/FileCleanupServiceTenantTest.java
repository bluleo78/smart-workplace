package com.workplace.file.service;

import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.global.tenant.TenantContext;
import com.workplace.support.IntegrationTestBase;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import java.util.function.Supplier;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * FileCleanupService 의 per-tenant 순회 검증 — 두 테넌트 각각의 만료 파일이 단 한 번의 cleanupExpiredFiles() 호출로 모두
 * 삭제되는지.
 *
 * <p>주의(MEMORY #95 패턴): TenantScopedRunner 는 REQUIRES_NEW 트랜잭션을 별도 커넥션으로 열어 '커밋된' 행만 본다. 따라서 단일 롤백
 * 트랜잭션으로 시드하면 Runner 가 행을 못 본다 → 반드시 커밋 시드 + 자기-스코프 @AfterEach 정리를 쓴다. 시드/검증은 테넌트별 LOCAL GUC 트랜잭션
 * (TenantContext.set + @Primary TransactionTemplate)으로 수행해 세션 GUC(=1)에 가려지지 않게 한다.
 */
class FileCleanupServiceTenantTest extends IntegrationTestBase {

  @Autowired private FileCleanupService fileCleanupService;
  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;

  private static final String TEST_TENANT_SLUG = "filecleanup-test-tenant-2";

  private long userId1;
  private long userId2;
  private long fileId1;
  private long fileId2;
  private long tid2;

  /** 고정 슬러그로 두 번째 ACTIVE 테넌트를 find-or-create(커밋). */
  private long ensureSecondTenant() {
    Long existing =
        dsl.select(TENANT.ID)
            .from(TENANT)
            .where(TENANT.SLUG.eq(TEST_TENANT_SLUG))
            .fetchOne(TENANT.ID);
    if (existing != null) {
      return existing;
    }
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, TEST_TENANT_SLUG)
        .set(TENANT.NAME, "FileCleanup Test Tenant 2")
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 주어진 테넌트 컨텍스트로 별도 트랜잭션(커밋)을 열어 supplier 실행 — LOCAL GUC 주입. */
  private <T> T inTenantTx(long tenantId, Supplier<T> body) {
    TenantContext.set(tenantId);
    try {
      return new TransactionTemplate(txManager).execute(status -> body.get());
    } finally {
      TenantContext.clear();
    }
  }

  /** USER 1행 시드(USER 는 RLS 비대상이라 세션 GUC 하에서 커밋 가능). */
  private long seedUser() {
    String s = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
    return dsl.insertInto(USER)
        .set(USER.USERNAME, "fct_" + s)
        .set(USER.PASSWORD, "pw")
        .set(USER.NAME, "Fct" + s)
        .set(USER.EMAIL, "fct_" + s + "@example.com")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 현재 테넌트 컨텍스트에서 만료된 FILE 1행 시드(tenant_id 는 GUC 디폴트가 채움 — 명시 set 하지 않음). */
  private long seedExpiredFile(long uploadedBy) {
    OffsetDateTime past = OffsetDateTime.now(ZoneOffset.UTC).minusDays(2);
    // storage_path 는 디스크에 없는 가짜 경로 — Files.deleteIfExists 가 false 를 반환할 뿐 예외 없음 → DB 행은 삭제된다.
    String fakePath = "/tmp/nonexistent-fct-" + UUID.randomUUID() + ".txt";
    return dsl.insertInto(FILE)
        .set(FILE.ORIGINAL_NAME, "fct.txt")
        .set(FILE.STORED_NAME, "fct.txt")
        .set(FILE.MIME_TYPE, "text/plain")
        .set(FILE.SIZE_BYTES, 5L)
        .set(FILE.CATEGORY, "TEXT")
        .set(FILE.STORAGE_PATH, fakePath)
        .set(FILE.UPLOADED_BY, uploadedBy)
        .set(FILE.CREATED_AT, past)
        .set(FILE.EXPIRES_AT, past)
        .returning(FILE.ID)
        .fetchOne()
        .getId();
  }

  /** 주어진 테넌트 컨텍스트에서 FILE 존재 여부 조회. */
  private boolean fileExists(long tenantId, long fileId) {
    return inTenantTx(
        tenantId, () -> dsl.fetchCount(dsl.selectFrom(FILE).where(FILE.ID.eq(fileId))) > 0);
  }

  @AfterEach
  void cleanup() {
    // 남아있을 수 있는 시드 FILE 행을 테넌트별로 정리(자기-스코프). tenant 행은 V46 로 DELETE 불가 → 잔존(무해).
    inTenantTx(
        1L,
        () -> {
          dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId1)).execute();
          return null;
        });
    inTenantTx(
        tid2,
        () -> {
          dsl.deleteFrom(FILE).where(FILE.ID.eq(fileId2)).execute();
          return null;
        });
    // 시드 USER 정리(USER 는 RLS 비대상 — FILE 삭제 후 NO ACTION FK 해소되어 삭제 가능). #512 누수 차단.
    if (userId1 != 0L || userId2 != 0L) {
      dsl.deleteFrom(USER).where(USER.ID.in(userId1, userId2)).execute();
    }
    TenantContext.clear();
  }

  /** 두 테넌트의 만료 파일이 단일 cleanupExpiredFiles() 호출로 모두 삭제됨(per-tenant 순회 커버). */
  @Test
  void cleanup_removesExpiredFilesAcrossAllTenants() {
    tid2 = ensureSecondTenant();
    userId1 = seedUser();
    userId2 = seedUser();

    fileId1 = inTenantTx(1L, () -> seedExpiredFile(userId1));
    fileId2 = inTenantTx(tid2, () -> seedExpiredFile(userId2));

    // 시드 직후 두 파일 모두 각 테넌트 컨텍스트에서 가시.
    assertThat(fileExists(1L, fileId1)).isTrue();
    assertThat(fileExists(tid2, fileId2)).isTrue();

    // 단일 호출 → 활성 테넌트 전체 순회.
    fileCleanupService.cleanupExpiredFiles();

    // 두 테넌트의 만료 파일 모두 삭제됨.
    assertThat(fileExists(1L, fileId1)).isFalse();
    assertThat(fileExists(tid2, fileId2)).isFalse();
  }
}
