package com.workplace.platform;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.platform.dto.AddTenantMemberRequest;
import com.workplace.platform.dto.CreateTenantRequest;
import com.workplace.platform.dto.TenantDetailResponse;
import com.workplace.platform.dto.TenantMemberResponse;
import com.workplace.platform.dto.TenantSummaryResponse;
import com.workplace.platform.exception.PlatformTenantNotFoundException;
import com.workplace.platform.service.PlatformTenantService;
import com.workplace.support.IntegrationTestBase;
import java.util.List;
import java.util.UUID;
import org.jooq.DSLContext;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운영자 콘솔 테넌트 서비스 통합 테스트.
 *
 * <p>⚠️ 클래스 레벨 {@code @Transactional} 필수: createTenantWithOwner 가 자체 트랜잭션(별도 빈)을 가지므로, 테스트 트랜잭션이
 * 없으면 공유 test DB(5435)에 tenant/membership 행이 실제 커밋되어 #95 드리프트/오염 flake 를 유발한다. 테스트 트랜잭션이 있으면
 * REQUIRED 전파로 repo 메서드가 합류해 롤백된다(Task 5 는 cross-connection 가시성을 검증하지 않는다 — 그건 Task 6).
 */
@Transactional
class PlatformTenantServiceTest extends IntegrationTestBase {

  @Autowired PlatformTenantService service;
  @Autowired DSLContext dsl;
  @Autowired AuthService authService;
  @Autowired JwtTokenProvider jwtTokenProvider;

  /** 신규 테넌트 GUC 하에서 특정 사용자에게 부여된 해당 이름의 RBAC 역할 수. GUC 미설정이면 RLS 로 비가시 → 0. */
  private int countRbacRole(Long tenantId, long userId, String roleName) {
    dsl.execute("select set_config('app.tenant_id', ?, true)", tenantId.toString());
    try {
      return dsl.fetchCount(
          dsl.select(USER_ROLE.USER_ID)
              .from(USER_ROLE)
              .join(ROLE)
              .on(ROLE.ID.eq(USER_ROLE.ROLE_ID))
              .where(USER_ROLE.USER_ID.eq(userId).and(ROLE.NAME.eq(roleName))));
    } finally {
      dsl.execute("select set_config('app.tenant_id', '', true)");
    }
  }

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
    return "t-" + UUID.randomUUID().toString().substring(0, 8);
  }

  @Test
  void createTenant_createsActiveTenantWithOwnerMembership() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Acme", uniqueSlug(), owner));

    assertThat(detail.name()).isEqualTo("Acme");
    assertThat(detail.status()).isEqualTo("ACTIVE");
    assertThat(detail.memberCount()).isEqualTo(1L);

    // OWNER 멤버십이 실제로 부여됐는지 확인.
    List<TenantMemberResponse> members = service.getMembers(detail.id());
    assertThat(members).hasSize(1);
    assertThat(members.get(0).userId()).isEqualTo(owner);
    assertThat(members.get(0).role()).isEqualTo("OWNER");
  }

  /**
   * #496 — 소유자 없이(null) 테넌트 생성: 멤버 0명인 빈 테넌트가 만들어지되, ADMIN/USER/AGENT 기본 역할은 그대로 시드돼야 한다(이후 멤버 추가
   * #497 가 찾아 씀). 역할은 RLS 대상이므로 신규 테넌트 GUC 로 전환해 조회한다.
   */
  @Test
  void createTenant_nullOwner_createsEmptyTenantWithSeededRoles() {
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Empty", uniqueSlug(), null));

    assertThat(detail.memberCount()).isEqualTo(0L);
    assertThat(service.getMembers(detail.id())).isEmpty();

    // 신규 테넌트 GUC 로 전환해 시드된 역할을 확인(트랜잭션-로컬, 직후 리셋).
    dsl.execute("select set_config('app.tenant_id', ?, true)", detail.id().toString());
    List<String> roleNames = dsl.select(ROLE.NAME).from(ROLE).fetch(ROLE.NAME);
    dsl.execute("select set_config('app.tenant_id', '', true)");
    assertThat(roleNames).contains("ADMIN", "USER", "AGENT");
  }

  @Test
  void createTenant_nonexistentOwner_throws() {
    assertThatThrownBy(
            () -> service.createTenant(new CreateTenantRequest("X", uniqueSlug(), 9_999_999L)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void createTenant_duplicateSlug_throws() {
    long owner = createHumanUser("owner");
    String slug = uniqueSlug();
    service.createTenant(new CreateTenantRequest("First", slug, owner));

    assertThatThrownBy(() -> service.createTenant(new CreateTenantRequest("Second", slug, owner)))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void listTenants_includesCreatedTenantWithMemberCount() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Listed", uniqueSlug(), owner));

    List<TenantSummaryResponse> all = service.listTenants();
    TenantSummaryResponse found =
        all.stream().filter(t -> t.id().equals(detail.id())).findFirst().orElseThrow();
    assertThat(found.memberCount()).isEqualTo(1L);
    assertThat(found.name()).isEqualTo("Listed");
  }

  @Test
  void suspendThenActivate_togglesStatus() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Toggle", uniqueSlug(), owner));

    service.suspend(detail.id());
    assertThat(service.getTenant(detail.id()).status()).isEqualTo("SUSPENDED");

    service.activate(detail.id());
    assertThat(service.getTenant(detail.id()).status()).isEqualTo("ACTIVE");
  }

  @Test
  void findMembers_returnsOwnerWithEmailAndRole() {
    long owner = createHumanUser("owner");
    TenantDetailResponse detail =
        service.createTenant(new CreateTenantRequest("Members", uniqueSlug(), owner));

    List<TenantMemberResponse> members = service.getMembers(detail.id());
    assertThat(members).hasSize(1);
    TenantMemberResponse m = members.get(0);
    assertThat(m.role()).isEqualTo("OWNER");
    assertThat(m.email()).isNotBlank();
    assertThat(m.status()).isEqualTo("ACTIVE");
  }

  /**
   * #497 — 소유자 없이 만든 테넌트에 멤버 화면에서 소유자(대표관리자)를 추가: 계정 생성 + OWNER 멤버십 + RBAC ADMIN 부여 + 즉시 로그인 가능.
   *
   * <p>GUC 마스킹 함정 방지: dsl 은 app 롤(RLS 적용, 소유자 아님)이고 테스트엔 ambient GUC 가 없으므로, assignTenantRoleByName
   * 가 GUC 를 안 잡으면 ROLE 조회가 비가시→예외로 실패한다(이 테스트가 그 회귀를 잡는다). 또 신규 테넌트 GUC 하에서 ADMIN user_role 이 실제 1건
   * 존재함을 단언한다.
   */
  @Test
  void addMember_owner_createsAccountMembershipAdminRoleAndCanLogin() {
    TenantDetailResponse tenant =
        service.createTenant(new CreateTenantRequest("OwnerLater", uniqueSlug(), null));
    String email = "owner-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";

    TenantMemberResponse m =
        service.addMember(
            tenant.id(), new AddTenantMemberRequest(email, "대표", "Password123", "OWNER"));

    // 멤버십 직위 = OWNER, 멤버 목록에 반영.
    assertThat(m.role()).isEqualTo("OWNER");
    assertThat(service.getMembers(tenant.id()))
        .extracting(TenantMemberResponse::role)
        .containsExactly("OWNER");

    // RBAC ADMIN 역할이 신규 테넌트 GUC 하에서 실제로 부여됐는지(GUC 미설정이면 0 → 실패).
    assertThat(countRbacRole(tenant.id(), m.userId(), "ADMIN")).isEqualTo(1);

    // 즉시 로그인 가능 — is_active=TRUE + 동일 PasswordEncoder + username=email. 단일 멤버십이라 tenant-scoped 토큰.
    var login = authService.login(new LoginRequest(email, "Password123"));
    assertThat(jwtTokenProvider.getTenantIdFromToken(login.accessToken())).isEqualTo(tenant.id());
  }

  /** #497 — 일반 멤버 추가: 멤버십 MEMBER + RBAC USER 역할. */
  @Test
  void addMember_member_assignsMemberAndUserRole() {
    TenantDetailResponse tenant =
        service.createTenant(new CreateTenantRequest("MemberTenant", uniqueSlug(), null));
    String email = "member-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";

    TenantMemberResponse m =
        service.addMember(
            tenant.id(), new AddTenantMemberRequest(email, "사원", "Password123", "MEMBER"));

    assertThat(m.role()).isEqualTo("MEMBER");
    assertThat(countRbacRole(tenant.id(), m.userId(), "USER")).isEqualTo(1);
    assertThat(countRbacRole(tenant.id(), m.userId(), "ADMIN")).isZero();
  }

  /** #497 — 중복 이메일로 멤버 추가 시 409. username=email 이므로 동일 이메일 재사용은 username 충돌로 먼저 잡힌다(둘 다 409 매핑). */
  @Test
  void addMember_duplicateEmail_throws() {
    TenantDetailResponse tenant =
        service.createTenant(new CreateTenantRequest("DupTenant", uniqueSlug(), null));
    String email = "dup-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    service.addMember(
        tenant.id(), new AddTenantMemberRequest(email, "첫째", "Password123", "MEMBER"));

    assertThatThrownBy(
            () ->
                service.addMember(
                    tenant.id(), new AddTenantMemberRequest(email, "둘째", "Password123", "MEMBER")))
        .isInstanceOf(UsernameAlreadyExistsException.class);
  }

  /** #497 — 존재하지 않는 테넌트에 멤버 추가 시 404. */
  @Test
  void addMember_unknownTenant_throwsNotFound() {
    assertThatThrownBy(
            () ->
                service.addMember(
                    9_999_999L,
                    new AddTenantMemberRequest(
                        "x-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com",
                        "X",
                        "Password123",
                        "OWNER")))
        .isInstanceOf(PlatformTenantNotFoundException.class);
  }

  @Test
  void getTenant_unknownId_throwsNotFound() {
    assertThatThrownBy(() -> service.getTenant(9_999_999L))
        .isInstanceOf(PlatformTenantNotFoundException.class);
  }

  @Test
  void suspend_unknownId_throwsNotFound() {
    assertThatThrownBy(() -> service.suspend(9_999_999L))
        .isInstanceOf(PlatformTenantNotFoundException.class);
  }
}
