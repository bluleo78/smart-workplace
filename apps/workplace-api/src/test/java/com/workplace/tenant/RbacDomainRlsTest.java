package com.workplace.tenant;

import static com.workplace.jooq.Tables.PERMISSION;
import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.ROLE_PERMISSION;
import static com.workplace.jooq.Tables.TENANT;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.permission.repository.PermissionRepository;
import com.workplace.support.IntegrationTestBase;
import java.util.Set;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * V61/V62 RBAC 도메인(role/role_permission/user_role) RLS 격리 증명.
 *
 * <p>전체를 롤백되는 단일 트랜잭션으로 수행 → 공유 DB 무오염 (app_tenant 는 tenant 행 DELETE 불가, V46; 롤백으로 미커밋
 * tenant/role/user 행 모두 사라짐).
 *
 * <p>마스킹 주의: application-test.yml 이 세션 GUC app.tenant_id=1 을 풀 커넥션마다 고정하므로, tenant#1 만 쓰는 격리 테스트는
 * 버그가 있어도 거짓-통과한다. 따라서 신규 tenant#2 를 트랜잭션 내에 삽입하고 setGuc(...) 로 트랜잭션-로컬 GUC 를 전환해 검증한다.
 * role/role_permission/user_role 삽입 시 tenant_id 는 설정하지 않고 GUC DEFAULT 가 채우게 둔다 (생성된 jOOQ 의 새
 * tenant_id 필드에 의존하지 않기 위함).
 */
class RbacDomainRlsTest extends IntegrationTestBase {

  @Autowired private DSLContext dsl;
  @Autowired private PlatformTransactionManager txManager;
  @Autowired private PermissionRepository permissionRepository;

  /** tenant#2 GUC 로 삽입한 role 은 tenant#1 컨텍스트에서 비가시. */
  @Test
  void role_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-role");

              // GUC 를 tid2 로 전환 후 role 삽입 — tenant_id 는 GUC DEFAULT 로 자동 세팅
              setGuc(tid2);
              Long rid =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "ROLE-ISO-" + System.nanoTime())
                      .set(ROLE.DESCRIPTION, "rls iso role")
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();

              // tid2 컨텍스트에서는 가시
              assertThat(dsl.fetchCount(dsl.selectFrom(ROLE).where(ROLE.ID.eq(rid)))).isEqualTo(1);

              // tenant#1 컨텍스트 → tid2 의 role 비가시 (RLS USING 차단)
              setGuc(1L);
              assertThat(dsl.fetchCount(dsl.selectFrom(ROLE).where(ROLE.ID.eq(rid)))).isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * uq_role_tenant_name 이 같은 역할 이름을 서로 다른 테넌트에서 허용함을 증명. tenant#1 에는 시스템 "ADMIN" 역할이 이미 존재하지만, tid2
   * 컨텍스트에서 같은 이름 "ADMIN" 역할을 삽입해도 유니크 위반이 발생하지 않아야 한다.
   */
  @Test
  void roleName_duplicateAcrossTenants_allowed() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-dup");

              // tid2 컨텍스트에서 "ADMIN" 삽입 — tenant_id 는 GUC DEFAULT 로 tid2. 전역이었다면 충돌하지만
              // (tenant_id, name) 유니크라 통과해야 한다.
              setGuc(tid2);
              Long rid =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "ADMIN")
                      .set(ROLE.DESCRIPTION, "tid2 admin")
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();

              assertThat(rid).isNotNull();
              assertThat(dsl.fetchCount(dsl.selectFrom(ROLE).where(ROLE.ID.eq(rid)))).isEqualTo(1);

              status.setRollbackOnly();
              return null;
            });
  }

  /** tenant#2 GUC 로 삽입한 role_permission 조인 행은 tenant#1 컨텍스트에서 비가시. */
  @Test
  void rolePermission_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-rp");

              // permission 은 전역 카탈로그 — 시드된 코드 하나 재사용
              Long permId =
                  dsl.select(PERMISSION.ID)
                      .from(PERMISSION)
                      .where(PERMISSION.CODE.eq("permission:read"))
                      .fetchOne(PERMISSION.ID);

              setGuc(tid2);
              Long rid =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "RP-ISO-" + System.nanoTime())
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(ROLE_PERMISSION)
                  .set(ROLE_PERMISSION.ROLE_ID, rid)
                  .set(ROLE_PERMISSION.PERMISSION_ID, permId)
                  .execute();

              // tid2 컨텍스트에서는 가시
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(ROLE_PERMISSION).where(ROLE_PERMISSION.ROLE_ID.eq(rid))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시
              setGuc(1L);
              assertThat(
                      dsl.fetchCount(
                          dsl.selectFrom(ROLE_PERMISSION).where(ROLE_PERMISSION.ROLE_ID.eq(rid))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /** tenant#2 GUC 로 삽입한 user_role 조인 행은 tenant#1 컨텍스트에서 비가시. */
  @Test
  void userRole_isIsolatedAcrossTenants() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-ur");
              Long userId = insertUser("rls-ur");

              setGuc(tid2);
              Long rid =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "UR-ISO-" + System.nanoTime())
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(USER_ROLE)
                  .set(USER_ROLE.USER_ID, userId)
                  .set(USER_ROLE.ROLE_ID, rid)
                  .execute();

              // tid2 컨텍스트에서는 가시
              assertThat(dsl.fetchCount(dsl.selectFrom(USER_ROLE).where(USER_ROLE.ROLE_ID.eq(rid))))
                  .isEqualTo(1);

              // tenant#1 컨텍스트 → 비가시
              setGuc(1L);
              assertThat(dsl.fetchCount(dsl.selectFrom(USER_ROLE).where(USER_ROLE.ROLE_ID.eq(rid))))
                  .isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * 핫패스 검증: 같은 사용자가 tenant#1 과 tenant#2 에서 서로 다른 권한을 갖도록 구성한 뒤,
   * PermissionRepository.findPermissionCodesByUserId(실제 권한 해석 쿼리)가 GUC 에 따라 테넌트별로 다른 권한을 반환함을 증명.
   * (이 메서드는 @Transactional 이 아니므로 테스트의 rollback 트랜잭션/ setGuc 를 그대로 따른다.)
   *
   * <p>tenant#2(≠ 세션 기본 1)를 쓰므로 마스킹을 무력화한다.
   */
  @Test
  void userPermissions_resolvePerTenant() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-perm");
              Long userId = insertUser("rls-perm");

              // 전역 permission 카탈로그에서 서로 다른 코드 둘 선택 (X=role:read, Y=role:write)
              Long permX =
                  dsl.select(PERMISSION.ID)
                      .from(PERMISSION)
                      .where(PERMISSION.CODE.eq("role:read"))
                      .fetchOne(PERMISSION.ID);
              Long permY =
                  dsl.select(PERMISSION.ID)
                      .from(PERMISSION)
                      .where(PERMISSION.CODE.eq("role:write"))
                      .fetchOne(PERMISSION.ID);

              // tenant#1: role + role_permission(X) + user_role — tenant_id 는 GUC DEFAULT(=1)
              setGuc(1L);
              Long ridT1 =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "PERM-T1-" + System.nanoTime())
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(ROLE_PERMISSION)
                  .set(ROLE_PERMISSION.ROLE_ID, ridT1)
                  .set(ROLE_PERMISSION.PERMISSION_ID, permX)
                  .execute();
              dsl.insertInto(USER_ROLE)
                  .set(USER_ROLE.USER_ID, userId)
                  .set(USER_ROLE.ROLE_ID, ridT1)
                  .execute();

              // tenant#2: 같은 사용자에게 다른 role + 권한(Y) — tenant_id 는 GUC DEFAULT(=tid2)
              setGuc(tid2);
              Long ridT2 =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "PERM-T2-" + System.nanoTime())
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              dsl.insertInto(ROLE_PERMISSION)
                  .set(ROLE_PERMISSION.ROLE_ID, ridT2)
                  .set(ROLE_PERMISSION.PERMISSION_ID, permY)
                  .execute();
              dsl.insertInto(USER_ROLE)
                  .set(USER_ROLE.USER_ID, userId)
                  .set(USER_ROLE.ROLE_ID, ridT2)
                  .execute();

              // tenant#1 컨텍스트 → X 만 (Y 는 tenant#2 → RLS 차단)
              setGuc(1L);
              Set<String> t1 = permissionRepository.findPermissionCodesByUserId(userId);
              assertThat(t1).contains("role:read").doesNotContain("role:write");

              // tenant#2 컨텍스트 → Y 만 (X 는 tenant#1 → RLS 차단)
              setGuc(tid2);
              Set<String> t2 = permissionRepository.findPermissionCodesByUserId(userId);
              assertThat(t2).contains("role:write").doesNotContain("role:read");

              status.setRollbackOnly();
              return null;
            });
  }

  /**
   * 메커니즘 테스트(signup/api-key 단절 클래스): tid2 GUC 로 role 삽입 후 빈-GUC 로 전환하면 role 이 비가시(count 0)임을 핀.
   * 컨텍스트가 미설정이면 RLS 가 role 읽기를 막는다는 것 — signup/api-key 경로에서 컨텍스트를 안 잡으면 깨지는 정확한 조건.
   */
  @Test
  void role_invisibleUnderEmptyGuc() {
    new TransactionTemplate(txManager)
        .execute(
            status -> {
              Long tid2 = insertTenant("rls-empty");

              setGuc(tid2);
              Long rid =
                  dsl.insertInto(ROLE)
                      .set(ROLE.NAME, "EMPTY-ISO-" + System.nanoTime())
                      .returning(ROLE.ID)
                      .fetchOne()
                      .getId();
              assertThat(dsl.fetchCount(dsl.selectFrom(ROLE).where(ROLE.ID.eq(rid)))).isEqualTo(1);

              // 빈 로컬 GUC → NULLIF(...,'') = NULL → 어떤 row 도 매칭 안 됨 (fail-closed)
              dsl.execute("SELECT set_config('app.tenant_id', '', true)");
              assertThat(dsl.fetchCount(dsl.selectFrom(ROLE).where(ROLE.ID.eq(rid)))).isZero();

              status.setRollbackOnly();
              return null;
            });
  }

  /** 신규 테넌트(tid)를 트랜잭션 내에 삽입하고 id 반환. */
  private Long insertTenant(String prefix) {
    return dsl.insertInto(TENANT)
        .set(TENANT.SLUG, prefix + "-" + System.nanoTime())
        .set(TENANT.NAME, prefix.toUpperCase())
        .set(TENANT.STATUS, "ACTIVE")
        .returning(TENANT.ID)
        .fetchOne()
        .getId();
  }

  /** 임시 user 삽입(kind 기본 HUMAN, 고유 username/email)하고 id 반환. user 는 전역 — RLS 비대상. */
  private Long insertUser(String prefix) {
    String suffix = prefix + "-" + System.nanoTime();
    return dsl.insertInto(USER)
        .set(USER.USERNAME, suffix)
        .set(USER.NAME, "RBAC RLS User")
        .set(USER.EMAIL, suffix + "@example.com")
        .set(USER.KIND, "HUMAN")
        .returning(USER.ID)
        .fetchOne()
        .getId();
  }

  /** 트랜잭션-로컬 GUC 직접 설정 헬퍼. */
  private void setGuc(Long tenantId) {
    dsl.execute("SELECT set_config('app.tenant_id', '" + tenantId + "', true)");
  }
}
