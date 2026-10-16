package com.workplace.tenant.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;

import com.workplace.tenant.dto.MembershipResponse;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/** 사용자-테넌트 소속 조회. tenant/membership 은 글로벌 테이블이라 RLS 비대상. */
@Repository
@RequiredArgsConstructor
public class MembershipRepository {

  /** WP-417: 워크스페이스 관리자가 정지한 멤버십 상태(V44 CHECK ACTIVE/SUSPENDED). */
  public static final String STATUS_ACTIVE = "ACTIVE";

  public static final String STATUS_SUSPENDED = "SUSPENDED";

  private final DSLContext dsl;

  /** WP-48: SSO 세션용 — ACTIVE 멤버십 중 테넌트가 ACTIVE 이고 SSO 가 켜진 것만. */
  @Transactional(readOnly = true)
  public List<MembershipResponse> findActiveSsoEnabledByUser(Long userId) {
    return dsl.select(TENANT.ID, TENANT.NAME, TENANT.SLUG)
        .from(MEMBERSHIP)
        .join(TENANT)
        .on(TENANT.ID.eq(MEMBERSHIP.TENANT_ID))
        .where(MEMBERSHIP.USER_ID.eq(userId))
        .and(MEMBERSHIP.STATUS.eq(STATUS_ACTIVE))
        .and(TENANT.STATUS.eq("ACTIVE"))
        .and(TENANT.SSO_ENABLED.isTrue())
        .fetch(r -> new MembershipResponse(r.value1(), r.value2(), r.value3()));
  }

  /** 사용자의 ACTIVE 멤버십(테넌트도 ACTIVE)만. 테넌트 선택 목록용. */
  @Transactional(readOnly = true)
  public List<MembershipResponse> findActiveByUser(Long userId) {
    return dsl.select(TENANT.ID, TENANT.NAME, TENANT.SLUG)
        .from(MEMBERSHIP)
        .join(TENANT)
        .on(TENANT.ID.eq(MEMBERSHIP.TENANT_ID))
        .where(MEMBERSHIP.USER_ID.eq(userId))
        .and(MEMBERSHIP.STATUS.eq(STATUS_ACTIVE))
        .and(TENANT.STATUS.eq("ACTIVE"))
        .fetch(r -> new MembershipResponse(r.value1(), r.value2(), r.value3()));
  }

  /** 테넌트의 ACTIVE 멤버 userId 전원 — TENANT scope SSE 수신자(공개 채널·공유 연락처 변경) 조회용 (WP-36). */
  @Transactional(readOnly = true)
  public List<Long> findActiveUserIdsByTenant(long tenantId) {
    return dsl.select(MEMBERSHIP.USER_ID)
        .from(MEMBERSHIP)
        .where(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .and(MEMBERSHIP.STATUS.eq(STATUS_ACTIVE))
        .fetch(MEMBERSHIP.USER_ID);
  }

  /**
   * 사용자-테넌트 멤버십을 생성한다. membership 은 전역 테넌트-경계 테이블(RLS 비대상)이므로 tenant#1 GUC 하에서도 삽입 가능. signup 에서 신규
   * 사용자에게 tenant#1 소속을 부여하는 데 사용한다(로그인 시 단일 멤버십 자동 선택).
   */
  public void create(Long userId, Long tenantId, String status) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, status)
        .execute();
  }

  /**
   * 지정한 역할(OWNER/ADMIN/MEMBER)로 멤버십을 생성한다. 운영자 콘솔의 테넌트 생성에서 초기 소유자에게 OWNER 를 부여하는 데 사용. membership
   * 은 전역 테이블이라 GUC 없이 삽입 가능. role 컬럼은 V69 에서 추가됐고 baseline jOOQ 코드젠에는 없으므로 name-based field 로 기록한다.
   */
  public void createWithRole(Long userId, Long tenantId, String status, String role) {
    dsl.insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, userId)
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, status)
        .set(org.jooq.impl.DSL.field(org.jooq.impl.DSL.name("role"), String.class), role)
        .execute();
  }

  /**
   * 해당 (user, tenant) 멤버십이 ACTIVE 인지. 멤버십 ACTIVE 만 본다(전역 is_active 미포함) — 워크스페이스 활성은 {@link
   * com.workplace.global.tenant.WorkspaceActive} 참고.
   */
  @Transactional(readOnly = true)
  public boolean hasActiveMembership(Long userId, Long tenantId) {
    return dsl.fetchExists(
        dsl.selectFrom(MEMBERSHIP)
            .where(MEMBERSHIP.USER_ID.eq(userId))
            .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
            .and(MEMBERSHIP.STATUS.eq(STATUS_ACTIVE)));
  }

  /**
   * WP-417: (user, tenant) 멤버십 상태(ACTIVE/SUSPENDED). 멤버가 아니면 빈 값. {@link #hasActiveMembership} 와 달리
   * 정지된 멤버도 "멤버"로 본다 — 관리자가 정지한 구성원을 계속 조회·재활성화하고, 재추가를 명확히 거절하는 데 쓴다.
   */
  @Transactional(readOnly = true)
  public Optional<String> findStatus(Long userId, Long tenantId) {
    return dsl.select(MEMBERSHIP.STATUS)
        .from(MEMBERSHIP)
        .where(MEMBERSHIP.USER_ID.eq(userId))
        .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .fetchOptional(MEMBERSHIP.STATUS);
  }

  /**
   * WP-417: (user, tenant) 멤버십 상태를 바꾼다(ACTIVE↔SUSPENDED). 워크스페이스 관리자의 「활성 상태」 토글이 전역
   * 계정(user.is_active) 대신 이 워크스페이스 소속만 정지·재개하게 하는 쓰기 경로. membership 은 전역 테이블(RLS 비대상)이라 tenantId 를
   * 반드시 명시한다.
   *
   * @return 갱신된 행 수(멤버가 아니면 0)
   */
  public int updateStatus(Long userId, Long tenantId, String status) {
    return dsl.update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, status)
        .where(MEMBERSHIP.USER_ID.eq(userId))
        .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .execute();
  }

  /**
   * 주어진 사용자 중 해당 테넌트에 ACTIVE 멤버십이 있는 id 만 돌려준다(#852). user 는 전역 테이블이라 id 만으로는 테넌트 경계가 없으므로, 외부에서 받은
   * user id(초대 참석자 등)를 쓰기 전에 이 술어로 걸러야 다른 테넌트 사용자를 끌어들이지 않는다.
   */
  @Transactional(readOnly = true)
  public Set<Long> findActiveUserIds(Collection<Long> userIds, Long tenantId) {
    if (userIds.isEmpty()) return Set.of();
    return dsl.selectDistinct(MEMBERSHIP.USER_ID)
        .from(MEMBERSHIP)
        .where(MEMBERSHIP.USER_ID.in(userIds))
        .and(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .and(MEMBERSHIP.STATUS.eq(STATUS_ACTIVE))
        .fetchSet(MEMBERSHIP.USER_ID);
  }
}
