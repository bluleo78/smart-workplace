package com.workplace.tenant.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;

import com.workplace.tenant.dto.MembershipResponse;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** 사용자-테넌트 소속 조회. tenant/membership 은 글로벌 테이블이라 RLS 비대상. */
@Repository
@RequiredArgsConstructor
public class MembershipRepository {

  private final DSLContext dsl;

  /** 사용자의 ACTIVE 멤버십(테넌트도 ACTIVE)만. 테넌트 선택 목록용. */
  @Transactional(readOnly = true)
  public List<MembershipResponse> findActiveByUser(Long userId) {
    return dsl.select(TENANT.ID, TENANT.NAME, TENANT.SLUG)
        .from(MEMBERSHIP)
        .join(TENANT)
        .on(TENANT.ID.eq(MEMBERSHIP.TENANT_ID))
        .where(MEMBERSHIP.USER_ID.eq(userId))
        .and(MEMBERSHIP.STATUS.eq("ACTIVE"))
        .and(TENANT.STATUS.eq("ACTIVE"))
        .fetch(r -> new MembershipResponse(r.value1(), r.value2(), r.value3()));
  }

  /** 해당 (user, tenant) 멤버십이 ACTIVE 인지. */
  @Transactional(readOnly = true)
  public boolean hasActiveMembership(Long userId, Long tenantId) {
    return dsl.fetchExists(
        dsl.selectFrom(MEMBERSHIP)
            .where(MEMBERSHIP.USER_ID.eq(userId))
            .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
            .and(MEMBERSHIP.STATUS.eq("ACTIVE")));
  }
}
