package com.workplace.platform.repository;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.PLATFORM_USER_ROLE;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.jooq.impl.DSL.select;
import static org.jooq.impl.DSL.val;

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
 * <p>⚠️ {@link #createTenantWithOwner} 의 {@code @Transactional} 은 이제 <b>commit-first 가 아니라 REQUIRED
 * 합류</b>다(Task 6). createTenant 전체가 단일 트랜잭션이므로 이 메서드는 호출자 트랜잭션에 합류하고, 같은 커넥션에서 RBAC 시드가 이어진다.
 * role.tenant_id FK 는 같은 트랜잭션의 미커밋 tenant 행을 보고(Postgres FK 는 자기 스냅샷 기준) 통과하며, RLS WITH CHECK 도
 * 트랜잭션-로컬 GUC 로 통과한다. <b>commit-first 로 되돌리지 말 것</b> — 시드 중간 실패 시 고아 테넌트가 남고 별도-커넥션 가시성 문제가 재발한다.
 * 시드 오케스트레이션은 {@code TenantProvisioningService} 참조.
 *
 * <p>아래 시드 메서드들({@link #setTenantGuc}/{@link #insertRole}/{@link #grantAllPermissions} 등)은 의도적으로
 * {@code @Transactional} 을 붙이지 않는다 — ambient(호출자) 트랜잭션의 바운드 커넥션에서 동작해야 set_config 와 INSERT 가 같은
 * 커넥션·트랜잭션을 공유하기 때문이다.
 */
@Repository
@RequiredArgsConstructor
public class PlatformTenantRepository {

  private final DSLContext dsl;
  private final MembershipRepository membershipRepository;

  /**
   * 테넌트 행(ACTIVE)을 생성하고, {@code ownerUserId} 가 주어지면 초기 소유자 OWNER 멤버십도 만든다. {@code ownerUserId} 가
   * null 이면 소유자 없는 빈 테넌트만 만든다(소유자는 이후 멤버 추가로 붙임, #496/#497). {@code @Transactional} 은
   * 호출자(createTenant)의 트랜잭션에 REQUIRED 로 합류하며, 커밋은 호출자 트랜잭션이 담당한다(단일-tx 설계 — 같은 커넥션에서 RBAC 시드가
   * 이어진다). 멤버십 role 컬럼은 baseline jOOQ 코드젠에 없어 name-based field 로 기록하는 {@link
   * MembershipRepository#createWithRole} 를 재사용한다.
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
    // 소유자 미지정(null) 이면 멤버십을 만들지 않는다 — 빈 테넌트.
    if (ownerUserId != null) {
      membershipRepository.createWithRole(ownerUserId, tenantId, "ACTIVE", "OWNER");
    }
    return tenantId;
  }

  // ============================================================
  // Task 6 — 신규 테넌트 RBAC 시드 (모두 ambient tx/커넥션에서 동작, @Transactional 금지)
  // role/role_permission/user_role 은 RLS 대상 → INSERT 시 app.tenant_id GUC 가 신규 테넌트여야 한다.
  // GUC 는 트랜잭션-로컬(set_config 3번째 인자 true)로 설정해 세션·풀 누수를 방지한다.
  // ============================================================

  /**
   * 현재 트랜잭션의 {@code app.tenant_id} GUC 를 신규 테넌트로 설정한다(트랜잭션-로컬). 이후 같은 커넥션의
   * role/role_permission/user_role INSERT 가 RLS WITH CHECK 를 통과하고 tenant_id DEFAULT(GUC)로 자동 충전된다.
   */
  public void setTenantGuc(Long tenantId) {
    dsl.execute("select set_config('app.tenant_id', ?, true)", tenantId.toString());
  }

  /** 트랜잭션-로컬 GUC 를 빈 문자열로 리셋한다(fail-closed) — 같은 tx 의 후속 작업이 시드 GUC 를 물려받지 않게 한다. */
  public void clearTenantGuc() {
    dsl.execute("select set_config('app.tenant_id', '', true)");
  }

  /**
   * 테넌트 스코프 역할을 INSERT 한다. tenant_id 는 명시하지 않아 DEFAULT(GUC)로 채워지고, created_at/updated_at 도 DB
   * DEFAULT 가 채운다. {@code .returning(ROLE.ID)} 로 신규 role id 를 반환한다.
   */
  public Long insertRole(String name, String description, boolean isSystem) {
    return dsl.insertInto(ROLE)
        .set(ROLE.NAME, name)
        .set(ROLE.DESCRIPTION, description)
        .set(ROLE.IS_SYSTEM, isSystem)
        .returning(ROLE.ID)
        .fetchOne()
        .getId();
  }

  /**
   * 지정 역할에 전체 permission(전역 카탈로그)을 부여한다 — permission cross. tenant_id 는 DEFAULT(GUC). ADMIN 역할이 V2
   * 와 동일하게 모든 권한을 갖도록 한다.
   */
  public void grantAllPermissions(Long roleId) {
    dsl.insertInto(ROLE_PERMISSION, ROLE_PERMISSION.ROLE_ID, ROLE_PERMISSION.PERMISSION_ID)
        .select(select(val(roleId), PERMISSION.ID).from(PERMISSION))
        .execute();
  }

  /** 지정 역할에 code 목록에 해당하는 permission 만 부여한다. tenant_id 는 DEFAULT(GUC). USER 역할 시드에 사용. */
  public void grantPermissionsByCode(Long roleId, List<String> codes) {
    dsl.insertInto(ROLE_PERMISSION, ROLE_PERMISSION.ROLE_ID, ROLE_PERMISSION.PERMISSION_ID)
        .select(
            select(val(roleId), PERMISSION.ID).from(PERMISSION).where(PERMISSION.CODE.in(codes)))
        .execute();
  }

  /** 사용자에게 역할을 할당한다(user_role INSERT). tenant_id 는 DEFAULT(GUC). 초기 Owner 에게 ADMIN 부여에 사용. */
  public void assignUserRole(Long userId, Long roleId) {
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, roleId)
        .execute();
  }

  /**
   * 기존 테넌트에 멤버십을 추가한다(전역 테이블, GUC 무관). role 은 멤버십 직위(OWNER/MEMBER). 멤버 추가(#497)에 사용한다.
   *
   * <p>{@code @Transactional} 은 호출자 트랜잭션에 REQUIRED 로 합류한다.
   */
  @Transactional
  public void addMembership(Long userId, Long tenantId, String role) {
    membershipRepository.createWithRole(userId, tenantId, "ACTIVE", role);
  }

  /**
   * 지정 테넌트의 RBAC 역할(이름 기준, 예: ADMIN/USER)을 사용자에게 부여한다 — 멤버 추가(#497)에 사용. role/user_role 은 RLS 대상이므로
   * 신규 테넌트 GUC 를 트랜잭션-로컬로 설정한 뒤 역할 조회·할당을 수행하고 finally 에서 빈 문자열로 리셋한다(seedDefaultRoles 와 동일 패턴).
   * 호출자({@code @Transactional})의 바운드 커넥션에서 set_config 와 INSERT 가 같은 트랜잭션을 공유해야 하므로 자체
   * {@code @Transactional} 을 붙이지 않는다.
   *
   * @throws IllegalStateException 해당 테넌트에 그 이름의 역할이 없을 때(시드 누락 — 정상 흐름에선 발생하지 않음)
   */
  public void assignTenantRoleByName(Long tenantId, Long userId, String roleName) {
    setTenantGuc(tenantId);
    try {
      Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq(roleName)).fetchOne(ROLE.ID);
      if (roleId == null) {
        throw new IllegalStateException("테넌트(" + tenantId + ")에 역할이 없습니다: " + roleName);
      }
      assignUserRole(userId, roleId);
    } finally {
      clearTenantGuc();
    }
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

  /** 단일 테넌트 상세 + 멤버 수 + 드라이브 한도(#81). */
  @Transactional(readOnly = true)
  public Optional<TenantDetailResponse> findTenant(Long id) {
    return dsl.select(
            TENANT.ID,
            TENANT.SLUG,
            TENANT.NAME,
            TENANT.STATUS,
            DSL.count(MEMBERSHIP.ID).as("member_count"),
            TENANT.CREATED_AT,
            TENANT.QUOTA_BYTES)
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
                    r.get(TENANT.CREATED_AT),
                    r.get(TENANT.QUOTA_BYTES)));
  }

  /**
   * 테넌트 드라이브 한도 갱신(#81).
   *
   * <p>tenant 는 RLS 비대상 테이블이므로 GUC 없이 UPDATE 가능하다.
   */
  @Transactional
  public void updateQuota(Long id, long quotaBytes) {
    dsl.update(TENANT).set(TENANT.QUOTA_BYTES, quotaBytes).where(TENANT.ID.eq(id)).execute();
  }

  /** 테넌트 상태를 갱신하고 영향 행 수를 반환(0 = 미존재). */
  @Transactional
  public int updateStatus(Long id, String status) {
    return dsl.update(TENANT).set(TENANT.STATUS, status).where(TENANT.ID.eq(id)).execute();
  }

  /** 테넌트 멤버 목록 — MEMBERSHIP join USER. isPlatformOperator 는 platform_user_role 보유 여부(마스킹 예외용). */
  @Transactional(readOnly = true)
  public List<TenantMemberResponse> findMembers(Long tenantId) {
    var roleField = DSL.field(DSL.name("membership", "role"), String.class);
    var isOperatorField =
        DSL.field(
            DSL.exists(
                DSL.selectOne()
                    .from(PLATFORM_USER_ROLE)
                    .where(PLATFORM_USER_ROLE.USER_ID.eq(USER.ID))));
    return dsl.select(
            USER.ID,
            USER.USERNAME,
            USER.NAME,
            USER.EMAIL,
            roleField,
            MEMBERSHIP.STATUS,
            isOperatorField)
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
                    r.get(MEMBERSHIP.STATUS),
                    r.get(isOperatorField)));
  }
}
