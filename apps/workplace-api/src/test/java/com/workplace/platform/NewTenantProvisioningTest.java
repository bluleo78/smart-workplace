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
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
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
    // #278: 신규 테넌트는 AGENT 시스템 역할을 받고, USER 에서 project:manage 를 뺀 12개 권한만 갖는다.
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("AgentRoleCheck", uniqueSlug(), owner));

    setGuc(detail.id().toString());
    Long agentRoleId =
        dsl.select(ROLE.ID)
            .from(ROLE)
            .where(ROLE.NAME.eq("AGENT"))
            .and(ROLE.TENANT_ID.eq(detail.id()))
            .fetchOne(ROLE.ID);
    assertThat(agentRoleId).isNotNull();

    Set<String> agentCodes =
        permissionRepository.findByRoleId(agentRoleId).stream()
            .map(PermissionResponse::code)
            .collect(Collectors.toSet());
    assertThat(agentCodes)
        .containsExactlyInAnyOrder(
            "project:read",
            "project:write",
            "issue:write",
            "label:manage",
            "savedview:manage",
            "cycle:manage",
            "contact:read",
            "contact:write",
            "calendar:read",
            "calendar:write",
            "user:read:self",
            "user:write:self");
  }

  @Test
  void createTenant_userRole_hasOnlyV2SelfPermissions() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("UserRoleCheck", uniqueSlug(), owner));

    // 신규 테넌트 GUC 로 USER 역할의 권한이 V2 기준(self 권한 2개)과 동일한지 검증.
    setGuc(detail.id().toString());
    Long userRoleId =
        dsl.select(ROLE.ID)
            .from(ROLE)
            .where(ROLE.NAME.eq("USER"))
            .and(ROLE.TENANT_ID.eq(detail.id()))
            .fetchOne(ROLE.ID);
    Set<String> userCodes =
        permissionRepository.findByRoleId(userRoleId).stream()
            .map(PermissionResponse::code)
            .collect(Collectors.toSet());
    assertThat(userCodes).containsExactlyInAnyOrder("user:read:self", "user:write:self");
  }
}
