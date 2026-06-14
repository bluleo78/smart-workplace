package com.workplace.platform.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.dto.TenantMemberResponse;
import com.workplace.platform.dto.TenantSummaryResponse;
import com.workplace.tenant.repository.MembershipRepository;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영자 콘솔 — 테넌트/멤버십 전역 테이블 직접 조작.
 *
 * <p>tenant/membership 은 글로벌(RLS 비대상) 테이블이라 app_tenant 런타임 롤도 GUC 없이 INSERT/UPDATE 가능하다(V44).
 * DELETE 만 회수(V46)되어 있어 생성/정지/활성화는 그대로 동작한다.
 *
 * <p>⚠️ {@link #createTenantWithOwner} 가 service 가 아닌 별도 빈(이 repository)에 있어야
 * {@code @Transactional} 프록시 경계가 생긴다. service 메서드에 트랜잭션이 없으므로, 이 메서드 반환 시점에 tenant 행 + OWNER 멤버십이 한
 * 트랜잭션으로 커밋된다. role.tenant_id 가 tenant FK 이므로(Task 6 역할 시드가 별도 커넥션에서 커밋된 tenant 행을 봐야 한다)
 * commit-first 는 하드 요구사항이다.
 */
@Repository
@RequiredArgsConstructor
public class PlatformTenantRepository {

  private final DSLContext dsl;
  private final MembershipRepository membershipRepository;

  /**
   * 테넌트 행(ACTIVE) + 초기 소유자 OWNER 멤버십을 한 트랜잭션에서 원자적으로 생성하고, 메서드 반환 시 커밋한다. 멤버십 role 컬럼은 baseline
   * jOOQ 코드젠에 없어 name-based field 로 기록하는 {@link MembershipRepository#createWithRole} 를 재사용한다.
   *
   * @return 생성된 tenant id
   */
  @Transactional
  public Long createTenantWithOwner(String name, String slug, Long ownerUserId) {
    Long tenantId =
        dsl.insertInto(TENANT)
            .set(TENANT.NAME, name)
            .set(TENANT.SLUG, slug)
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();
    membershipRepository.createWithRole(ownerUserId, tenantId, "ACTIVE", "OWNER");
    return tenantId;
  }

  /** 동일 slug 테넌트가 이미 존재하는지(slug != null 일 때만 의미 있음). */
  @Transactional(readOnly = true)
  public boolean slugExists(String slug) {
    return dsl.fetchExists(dsl.selectOne().from(TENANT).where(TENANT.SLUG.eq(slug)));
  }

  /** 전체 테넌트 목록 + 멤버 수 집계. 0-멤버 테넌트도 보이도록 left join. */
  @Transactional(readOnly = true)
  public List<TenantSummaryResponse> listTenants() {
    return dsl.select(
            TENANT.ID,
            TENANT.SLUG,
            TENANT.NAME,
            TENANT.STATUS,
            DSL.count(MEMBERSHIP.ID).as("member_count"),
            TENANT.CREATED_AT)
        .from(TENANT)
        .leftJoin(MEMBERSHIP)
        .on(MEMBERSHIP.TENANT_ID.eq(TENANT.ID))
        .groupBy(TENANT.ID)
        .orderBy(TENANT.ID)
        .fetch(
            r ->
                new TenantSummaryResponse(
                    r.get(TENANT.ID),
                    r.get(TENANT.SLUG),
                    r.get(TENANT.NAME),
                    r.get(TENANT.STATUS),
                    r.get("member_count", Integer.class).longValue(),
                    r.get(TENANT.CREATED_AT)));
  }

  /** 단일 테넌트 상세 + 멤버 수. */
  @Transactional(readOnly = true)
  public Optional<TenantDetailResponse> findTenant(Long id) {
    return dsl.select(
            TENANT.ID,
            TENANT.SLUG,
            TENANT.NAME,
            TENANT.STATUS,
            DSL.count(MEMBERSHIP.ID).as("member_count"),
            TENANT.CREATED_AT)
        .from(TENANT)
        .leftJoin(MEMBERSHIP)
        .on(MEMBERSHIP.TENANT_ID.eq(TENANT.ID))
        .where(TENANT.ID.eq(id))
        .groupBy(TENANT.ID)
        .fetchOptional(
            r ->
                new TenantDetailResponse(
                    r.get(TENANT.ID),
                    r.get(TENANT.SLUG),
                    r.get(TENANT.NAME),
                    r.get(TENANT.STATUS),
                    r.get("member_count", Integer.class).longValue(),
                    r.get(TENANT.CREATED_AT)));
  }

  /** 테넌트 상태를 갱신하고 영향 행 수를 반환(0 = 미존재). */
  @Transactional
  public int updateStatus(Long id, String status) {
    return dsl.update(TENANT).set(TENANT.STATUS, status).where(TENANT.ID.eq(id)).execute();
  }

  /** 테넌트 멤버 목록 — MEMBERSHIP join USER. role 은 V69 추가 컬럼이라 name-based field 로 읽는다. */
  @Transactional(readOnly = true)
  public List<TenantMemberResponse> findMembers(Long tenantId) {
    var roleField = DSL.field(DSL.name("membership", "role"), String.class);
    return dsl.select(USER.ID, USER.USERNAME, USER.NAME, USER.EMAIL, roleField, MEMBERSHIP.STATUS)
        .from(MEMBERSHIP)
        .join(USER)
        .on(USER.ID.eq(MEMBERSHIP.USER_ID))
        .where(MEMBERSHIP.TENANT_ID.eq(tenantId))
        .orderBy(USER.ID)
        .fetch(
            r ->
                new TenantMemberResponse(
                    r.get(USER.ID),
                    r.get(USER.USERNAME),
                    r.get(USER.NAME),
                    r.get(USER.EMAIL),
                    r.get(roleField),
                    r.get(MEMBERSHIP.STATUS)));
  }
}
