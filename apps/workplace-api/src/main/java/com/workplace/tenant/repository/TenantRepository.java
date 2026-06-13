package com.workplace.tenant.repository;

import static com.workplace.jooq.Tables.TENANT;

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
}
