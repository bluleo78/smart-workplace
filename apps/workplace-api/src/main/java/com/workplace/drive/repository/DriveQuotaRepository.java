package com.workplace.drive.repository;

import static com.workplace.jooq.Tables.DRIVE_FILE;
import static com.workplace.jooq.Tables.FILE;
import static com.workplace.jooq.Tables.TENANT;

import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** 드라이브 쿼터용 집계/잠금 쿼리. */
@Repository
public class DriveQuotaRepository {

  private final DSLContext dsl;

  public DriveQuotaRepository(DSLContext dsl) {
    this.dsl = dsl;
  }

  /**
   * 현재 테넌트의 드라이브 사용량(바이트) — live 파일만.
   *
   * <p>drive_file 조인으로 chat/messaging 첨부를 배제하고, trashed_at IS NULL 로 휴지통을 제외한다. 테넌트 격리는
   * RLS(app.tenant_id)가 처리하므로 명시 tenant_id 조건은 두지 않는다.
   */
  public long sumDriveUsageBytes() {
    Long result =
        dsl.select(DSL.coalesce(DSL.sum(FILE.SIZE_BYTES), DSL.inline(0L)))
            .from(DRIVE_FILE)
            .join(FILE)
            .on(FILE.ID.eq(DRIVE_FILE.FILE_ID))
            .where(DRIVE_FILE.TRASHED_AT.isNull())
            .fetchOne(0, Long.class);
    return result == null ? 0L : result;
  }

  /** 테넌트 한도(바이트). tenant 는 RLS 비대상이므로 id 를 명시한다. */
  public long findQuotaBytes(long tenantId) {
    Long v =
        dsl.select(TENANT.QUOTA_BYTES)
            .from(TENANT)
            .where(TENANT.ID.eq(tenantId))
            .fetchOne(TENANT.QUOTA_BYTES);
    return v == null ? 0L : v;
  }

  /**
   * 드라이브 쿼터 잠금 전용 classId — 2-인자 pg_advisory_xact_lock(classId, tenantId) 형태에서 사용.
   *
   * <p>Postgres 에서 2-인자(int, int) advisory lock 은 1-인자(bigint) lock 과 별개 네임스페이스를 사용하므로,
   * UserRepository.acquireFirstUserLock() 등 다른 도메인의 1-인자 잠금과 충돌하지 않는다. 이슈 번호(#81)를 classId 로 사용해
   * drive 쿼터 잠금임을 명시한다.
   */
  private static final int DRIVE_QUOTA_LOCK_CLASS = 81;

  /** 테넌트 단위 직렬화 잠금 — 동시 업로드 시 check-then-insert 레이스 방지(트랜잭션 종료 시 자동 해제). */
  public void advisoryLockTenant(long tenantId) {
    // 2-인자 형태로 drive 전용 네임스페이스(DRIVE_QUOTA_LOCK_CLASS=81)를 분리해
    // 타 도메인 1-인자 잠금과의 전역 충돌을 방지한다.
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", DRIVE_QUOTA_LOCK_CLASS, (int) tenantId);
  }
}
