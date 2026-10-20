package com.workplace.global.security;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.service.PermissionService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.outbound.WorkspaceMembershipSuspended;
import com.workplace.user.service.UserService;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultMatcher;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-420 — 워크스페이스 멤버십이 정지(SUSPENDED)되면 그 워크스페이스로 <b>이미 발급된</b> 액세스 토큰도 즉시 401 이어야 한다. WP-417 은 정지를
 * refresh·PAT 에만 반영해, 남은 액세스 토큰(최대 30분)으로 계속 쓸 수 있었다.
 *
 * <p>T_A 는 시드 역할(ADMIN 권한 포함)이 있는 테넌트#1, T_B 는 새 테넌트. 클래스 레벨 {@code @Transactional} 이라 MockMvc
 * 요청(같은 스레드)이 이 트랜잭션에 합류해 미커밋 정지를 본다. RLS GUC 는 필터의 TenantContext 로 바뀌지 않으므로 요청마다 토큰 테넌트로 {@code
 * useTenant} 를 맞춘다(역할 조회가 엉뚱한 테넌트로 통과·실패하지 않게). 커밋 후 연결 종료는 WikiCollabSaveIntegrationTest 에서 본다.
 */
@Transactional
@RecordApplicationEvents
class SuspendedMembershipJwtTest extends IntegrationTestBase {
  private static final long TENANT_A = 1L;

  @Autowired MockMvc mvc;
  @Autowired DSLContext dsl;
  @Autowired JwtTokenProvider jwt;
  @Autowired UserService userService;
  @Autowired PermissionService permissionService;
  @Autowired MembershipRepository membershipRepository;
  @Autowired ApplicationEvents events;

  private long tenantB;
  private long adminRoleA;

  @BeforeEach
  void setUp() {
    tenantB = TestFixtures.createTenant(dsl, "ACTIVE");
    useTenant(TENANT_A);
    adminRoleA = dsl.select(ROLE.ID).from(ROLE).where(ROLE.NAME.eq("ADMIN")).fetchOne(ROLE.ID);
    // 마지막 활성 ADMIN 가드에 걸리지 않도록 T_A 에 다른 활성 ADMIN 을 하나 더 둔다.
    grantAdminInA(withMembership(TestFixtures.createHuman(dsl)));
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private void grantAdminInA(long userId) {
    useTenant(TENANT_A);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, userId)
        .set(USER_ROLE.ROLE_ID, adminRoleA)
        .execute();
  }

  /** 토큰의 테넌트로 GUC 를 맞춘 뒤 GET 해 상태를 검사한다. */
  private void expect(String path, String token, long tokenTenant, ResultMatcher status)
      throws Exception {
    useTenant(tokenTenant);
    mvc.perform(get(path).header("Authorization", "Bearer " + token)).andExpect(status);
  }

  @Test
  void suspendedAdmin_existingTokenOfThatWorkspace_isRejected_otherWorkspaceKeepsWorking()
      throws Exception {
    long u = withMembership(TestFixtures.createHuman(dsl));
    membershipRepository.create(u, tenantB, "ACTIVE");
    grantAdminInA(u);
    String tokenA = jwt.generateAccessToken(u, "human-" + u, TENANT_A);
    String tokenB = jwt.generateAccessToken(u, "human-" + u, tenantB);

    // 정지 전: 인증 전용·멤버 기본 권한(member:read)·관리자 권한(user:read) 엔드포인트 모두 통과.
    expect("/api/v1/auth/me", tokenA, TENANT_A, status().isOk());
    expect("/api/v1/members", tokenA, TENANT_A, status().isOk());
    expect("/api/v1/users", tokenA, TENANT_A, status().isOk());

    useTenant(TENANT_A);
    userService.setUserActive(u, false, null);

    // 같은(아직 만료되지 않은) T_A 토큰 → 인증 자체가 서지 않아 401. 남은 ADMIN user_role 로도 통과하지 못한다.
    expect("/api/v1/auth/me", tokenA, TENANT_A, status().isUnauthorized());
    expect("/api/v1/members", tokenA, TENANT_A, status().isUnauthorized());
    expect("/api/v1/users", tokenA, TENANT_A, status().isUnauthorized());
    // 다른 워크스페이스(T_B) 토큰은 영향 없음.
    expect("/api/v1/auth/me", tokenB, tenantB, status().isOk());

    // 공유 권한 조회도 정지된 멤버에게 역할 권한까지 주지 않는다(PAT·API 키·PermissionChecker 경로의 방어선).
    useTenant(TENANT_A);
    assertThat(permissionService.getUserPermissions(u)).isEmpty();
    assertThat(permissionService.getActiveMemberPermissions(u)).isEmpty();

    // 커밋 후 연결 종료용 이벤트가 테넌트·사용자를 담아 한 번 발행된다.
    assertThat(events.stream(WorkspaceMembershipSuspended.class))
        .containsExactly(new WorkspaceMembershipSuspended(TENANT_A, u));

    // 다시 활성화하면 같은 T_A 토큰이 다시 통과한다 — 토큰 폐기가 아니라 요청마다의 멤버십 판정이다. 재개는 이벤트를 내지 않는다.
    useTenant(TENANT_A);
    userService.setUserActive(u, true, null);
    expect("/api/v1/auth/me", tokenA, TENANT_A, status().isOk());
    expect("/api/v1/users", tokenA, TENANT_A, status().isOk());
    assertThat(events.stream(WorkspaceMembershipSuspended.class)).hasSize(1);
  }

  /** 멤버십이 아예 없는 테넌트의 토큰(위조가 아닌 서명된 토큰이라도)은 인증되지 않는다. */
  @Test
  void tokenForWorkspaceWithoutMembership_isRejected() throws Exception {
    long u = withMembership(TestFixtures.createHuman(dsl));
    String tokenB = jwt.generateAccessToken(u, "human-" + u, tenantB);
    expect("/api/v1/auth/me", tokenB, tenantB, status().isUnauthorized());
  }

  /** tenant 없는 토큰(소속 없음·워크스페이스 선택 전)은 멤버십 판정 대상이 아니다 — 기존대로 인증된다. */
  @Test
  void tenantlessToken_isStillAuthenticated() throws Exception {
    long u = TestFixtures.createHuman(dsl);
    String token = jwt.generateAccessToken(u, "human-" + u);
    TenantContext.clear();
    mvc.perform(get("/api/v1/auth/me").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
  }

  /** ACTIVE 멤버지만 역할이 없으면 인증은 서고 멤버 기본 권한만 갖는다(빈 결과를 "비멤버"로 오판하지 않는다). */
  @Test
  void activeMemberWithoutRole_isAuthenticatedWithBaselineOnly() throws Exception {
    long u = withMembership(TestFixtures.createHuman(dsl));
    String token = jwt.generateAccessToken(u, "human-" + u, TENANT_A);
    expect("/api/v1/auth/me", token, TENANT_A, status().isOk());
    expect("/api/v1/members", token, TENANT_A, status().isOk());
    expect("/api/v1/users", token, TENANT_A, status().isForbidden());
  }
}
