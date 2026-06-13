package com.workplace.tenant.repository;

import static com.workplace.jooq.Tables.TENANT;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** 테넌트 조회. */
@Repository
@RequiredArgsConstructor
public class TenantRepository {

  private final DSLContext dsl;

  /** 테넌트가 존재하고 ACTIVE 인지(SUSPENDED 차단용). */
  @Transactional(readOnly = true)
  public boolean isActive(Long tenantId) {
    return dsl.fetchExists(
        dsl.selectFrom(TENANT).where(TENANT.ID.eq(tenantId)).and(TENANT.STATUS.eq("ACTIVE")));
  }

  /**
   * 활성(ACTIVE) 테넌트 ID 목록 — 시스템 잡(스케줄러/부팅 잡)의 테넌트별 순회용. tenant 는 글로벌 테이블(RLS 비대상)이라 GUC 가 없어도 조회된다.
   */
  @Transactional(readOnly = true)
  public List<Long> findActiveTenantIds() {
    return dsl.select(TENANT.ID)
        .from(TENANT)
        .where(TENANT.STATUS.eq("ACTIVE"))
        .orderBy(TENANT.ID)
        .fetch(TENANT.ID);
  }
}
