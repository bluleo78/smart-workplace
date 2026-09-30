package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;

import com.workplace.permission.dto.PermissionResponse;
import com.workplace.permission.repository.PermissionRepository;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.service.PlatformTenantService;
import com.workplace.support.IntegrationTestBase;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ClassPathResource;
import org.springframework.transaction.annotation.Transactional;

/**
 * Task 6 — 신규 테넌트 RBAC 시드(가장 위험한 RLS 시드) 통합 테스트.
 *
 * <p>핵심 검증: createTenant 가 단일 트랜잭션에서 tenant + membership 삽입 후 트랜잭션-로컬 GUC 로
 * role/role_permission/user_role 을 시드하므로, role.tenant_id FK 가 미커밋 tenant 행을 보고 RLS WITH CHECK 를
 * 통과한다(FK 위반 없이 성공 = 단일-tx 순서 정확).
 *
 * <p>⚠️ 테스트 하버스는 connection-init-sql 로 세션 GUC=tenant#1 을 깔아둔다. 시드 finally 가 GUC 를 ''로 리셋하므로, 각 단언
 * 블록 직전에 필요한 GUC 를 명시적으로 set_config(트랜잭션-로컬, true)로 깔고 검증한다(상속 GUC 에 기대지 않음 — vacuous-pass 방지). 모든
 * {@code @Transactional} 읽기 메서드는 이 테스트 tx 에 합류하므로 같은 GUC 를 본다.
 */
@Transactional
class NewTenantProvisioningTest extends IntegrationTestBase {

  @Autowired PlatformTenantService service;
  @Autowired PermissionRepository permissionRepository;
  @Autowired DSLContext dsl;

  /** HUMAN 사용자 시드 — ownerUserId 용 실제 유저. id 반환. */
  private long createHumanUser(String prefix) {
    String suffix = UUID.randomUUID().toString().substring(0, 8);
    Long id =
        dsl.insertInto(USER)
            .set(USER.USERNAME, prefix + "-" + suffix)
            .set(USER.PASSWORD, "pw")
            .set(USER.NAME, prefix)
            .set(USER.EMAIL, prefix + "-" + suffix + "@example.com")
            .returning(USER.ID)
            .fetchOne()
            .getId();
    Long roleId = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("USER")).fetchOne(ROLE.ID);
    dsl.insertInto(USER_ROLE).set(USER_ROLE.USER_ID, id).set(USER_ROLE.ROLE_ID, roleId).execute();
    return id;
  }

  private String uniqueSlug() {
    return "prov-" + UUID.randomUUID().toString().substring(0, 8);
  }

  /** 단언 블록 직전에 트랜잭션-로컬 GUC 를 명시적으로 설정한다(상속 GUC vacuous-pass 방지). */
  private void setGuc(String tenantId) {
    dsl.execute("select set_config('app.tenant_id', ?, true)", tenantId);
  }

  /** 해당 테넌트 GUC 로 전환한 뒤 시스템 역할 id 를 찾는다(RLS 상 GUC 가 맞아야 보인다). */
  private Long systemRoleId(long tenantId, String roleName) {
    setGuc(Long.toString(tenantId));
    Long roleId =
        dsl.select(ROLE.ID)
            .from(ROLE)
            .where(ROLE.NAME.eq(roleName))
            .and(ROLE.TENANT_ID.eq(tenantId))
            .fetchOne(ROLE.ID);
    assertThat(roleId).isNotNull();
    return roleId;
  }

  /** 해당 테넌트 시스템 역할의 permission code 집합. */
  private Set<String> roleCodes(long tenantId, String roleName) {
    Long roleId = systemRoleId(tenantId, roleName);
    return permissionRepository.findByRoleId(roleId).stream()
        .map(PermissionResponse::code)
        .collect(Collectors.toSet());
  }

  @Test
  void createTenant_seedsUsableRbac_andIsolatesByTenant() {
    long owner = createHumanUser("owner");

    // FK 위반 없이 성공 = 단일-tx 순서(tenant→GUC→role) 정확함을 증명.
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Provisioned", uniqueSlug(), owner));
    Long newId = detail.id();

    // ── (1) Owner 사용 가능성: 신규 테넌트 GUC 에서 Owner 가 전체 permission code 를 갖는다. ──
    setGuc(newId.toString());
    Set<String> ownerCodes = permissionRepository.findPermissionCodesByUserId(owner);
    Set<String> allCodes =
        permissionRepository.findAll().stream()
            .map(PermissionResponse::code)
            .collect(Collectors.toSet());
    assertThat(ownerCodes).isNotEmpty(); // 빈결과면 fail-closed(GUC 미설정) — 시드 실패 증명.
    assertThat(ownerCodes).isEqualTo(allCodes); // ADMIN = 전체 권한.

    // ── (2) RLS 격리(non-vacuous, 두 방향): ──
    // 2a. tenant#1 GUC 로는 신규 테넌트 role 이 보이지 않는다(== 0).
    setGuc("1");
    int visibleFromTenant1 =
        dsl.selectCount().from(ROLE).where(ROLE.TENANT_ID.eq(newId)).fetchOne(0, int.class);
    assertThat(visibleFromTenant1).isZero();

    // 2b. 신규 테넌트 GUC 로는 ADMIN+USER+AGENT 3개가 보인다(== 3). (#278 AGENT 역할 추가)
    setGuc(newId.toString());
    int visibleFromNew =
        dsl.selectCount().from(ROLE).where(ROLE.TENANT_ID.eq(newId)).fetchOne(0, int.class);
    assertThat(visibleFromNew).isEqualTo(3);
  }

  @Test
  void createTenant_seedsAgentRole_withCuratedPermissions() {
    // #278: 신규 테넌트는 AGENT 시스템 역할을 받고, tenant#1 AGENT(V75 + V132)와 같은 권한 집합을 갖는다.
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("AgentRoleCheck", uniqueSlug(), owner));

    Set<String> agentCodes = roleCodes(detail.id(), "AGENT");
    // #833: 구성원 디렉터리 조회 — AI 가 이름으로 userId 를 확정하는 경로.
    assertThat(agentCodes).contains("member:read", "contact:read", "issue:write");
    // 관리성 권한은 AGENT 에 주지 않는다.
    assertThat(agentCodes).doesNotContain("project:manage", "milestone:manage", "role:assign");
    // 드리프트 가드: 마이그레이션이 AGENT 에 권한을 추가하면 시드 상수도 같이 바꿔야 한다.
    assertThat(agentCodes).isEqualTo(roleCodes(1L, "AGENT"));
  }

  @Test
  void createTenant_userRole_hasWorkPermissions_sameAsTenant1User() {
    // WP-104: 신규 테넌트 USER 가 self 권한만 받아 연락처·프로젝트·이슈·캘린더가 전부 403 이던 문제.
    // 일반 구성원이 실제로 일할 수 있도록 tenant#1 USER(마이그레이션으로 누적된 권한)와 같은 집합을 받아야 한다.
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("UserRoleCheck", uniqueSlug(), owner));

    Set<String> userCodes = roleCodes(detail.id(), "USER");
    // 연락처 화면(WP-104 증상)을 비롯한 업무 API 권한이 있어야 한다.
    assertThat(userCodes).contains("contact:read", "project:read", "issue:write", "calendar:read");
    // 계정 관리(user:read/user:write/role:assign)는 여전히 ADMIN 전용이라 포함되지 않는다.
    assertThat(userCodes).doesNotContain("user:read", "user:write", "role:assign");
    // 드리프트 가드: tenant#1 USER 와 집합이 어긋나면(한쪽에만 권한 추가) 신규 테넌트가 다시 약해진다.
    assertThat(userCodes).isEqualTo(roleCodes(1L, "USER"));
  }

  @Test
  void v139_backfillsMissingUserPermissions_forExistingTenant() throws Exception {
    // WP-104: 수정 전 시드로 만들어진 테넌트(USER = self 권한 3개)를 재현한 뒤, V139 스크립트를 다시 실행하면
    // tenant#1 USER 와 같은 집합이 채워져야 한다. Flyway 는 기동 시 tenant#1 만 있는 DB 에 V139 를 적용하므로
    // 다른 테넌트 보충 경로는 스크립트를 직접 실행해서 검증한다.
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("BackfillCheck", uniqueSlug(), owner));
    long tenantId = detail.id();

    Long userRoleId = systemRoleId(tenantId, "USER");
    // 수정 전 시드 상태로 되돌린다 — self 권한 3개만 남긴다.
    dsl.execute(
        "delete from role_permission rp using permission p"
            + " where rp.permission_id = p.id and rp.role_id = ?"
            + " and p.code not in ('member:read', 'user:read:self', 'user:write:self')",
        userRoleId);
    assertThat(permissionRepository.findByRoleId(userRoleId)).hasSize(3);

    String script =
        new ClassPathResource("db/migration/V139__backfill_tenant_user_role_permissions.sql")
            .getContentAsString(StandardCharsets.UTF_8);
    dsl.execute(script);
    // 재실행해도 중복 INSERT(PK 충돌) 없이 같은 결과여야 한다.
    dsl.execute(script);

    assertThat(roleCodes(tenantId, "USER")).isEqualTo(roleCodes(1L, "USER"));
  }
}
