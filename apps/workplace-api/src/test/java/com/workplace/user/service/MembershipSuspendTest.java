package com.workplace.user.service;

import static com.workplace.jooq.Tables.ROLE;
import static com.workplace.jooq.Tables.USER;
import static com.workplace.jooq.Tables.USER_ROLE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.exception.TenantAccessDeniedException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.TenantContext;
import com.workplace.member.dto.MemberSummary;
import com.workplace.member.service.MemberDirectoryService;
import com.workplace.platform.dto.AddExistingTenantMemberRequest;
import com.workplace.platform.exception.TenantMemberAlreadyExistsException;
import com.workplace.platform.service.PlatformTenantService;
import com.workplace.support.IntegrationTestBase;
import com.workplace.support.TestFixtures;
import com.workplace.support.TestFixtures.LoginableHuman;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import java.util.List;
import java.util.Optional;
import org.jooq.DSLContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;

/**
 * WP-417 — 사용자 「활성 상태」 끄기는 전역 계정(user.is_active)이 아니라 <b>현재 워크스페이스의 멤버십</b>(membership.status
 * ACTIVE↔SUSPENDED)만 정지해야 한다. 한 워크스페이스(T_A)에서 정지한 사용자가 다른 워크스페이스(T_B)·로그인까지 막히던 결함의 재현·회귀 가드.
 *
 * <p>@Transactional 롤백으로 시드는 남지 않는다. role/user_role 은 RLS 대상이고 테스트 트랜잭션 도중 TenantContext 만 바꿔서는
 * GUC(app.tenant_id)가 따라오지 않으므로 {@code useTenant} 로 둘을 함께 바꾼다.
 */
@Transactional
class MembershipSuspendTest extends IntegrationTestBase {

  private static final String PASSWORD = "Password123";

  @Autowired private UserService userService;
  @Autowired private AuthService authService;
  @Autowired private MemberDirectoryService memberDirectoryService;
  @Autowired private PlatformTenantService platformTenantService;
  @Autowired private MembershipRepository membershipRepository;
  @Autowired private JwtTokenProvider jwtTokenProvider;
  @Autowired private PasswordEncoder passwordEncoder;
  @Autowired private DSLContext dsl;

  private long tenantA;
  private long tenantB;
  private long adminRoleA;

  @BeforeEach
  void setUp() {
    tenantA = TestFixtures.createTenant(dsl, "ACTIVE");
    tenantB = TestFixtures.createTenant(dsl, "ACTIVE");
    // T_A 의 ADMIN 역할 — 새 테넌트는 역할 시드가 없으므로 T_A GUC 하에서 직접 만든다(role 은 RLS 대상).
    useTenant(tenantA);
    adminRoleA =
        dsl.insertInto(ROLE)
            .set(ROLE.NAME, "ADMIN")
            .set(ROLE.IS_SYSTEM, true)
            .returning(ROLE.ID)
            .fetchOne()
            .getId();
  }

  @AfterEach
  void clearTenant() {
    TenantContext.clear();
  }

  private LoginableHuman createLoginableHuman() {
    return TestFixtures.createLoginableHuman(dsl, passwordEncoder.encode(PASSWORD));
  }

  /** T_A 에 ADMIN 역할을 가진 ACTIVE 멤버를 만든다. */
  private long createAdminInA() {
    long id = createLoginableHuman().id();
    membershipRepository.create(id, tenantA, "ACTIVE");
    useTenant(tenantA);
    dsl.insertInto(USER_ROLE)
        .set(USER_ROLE.USER_ID, id)
        .set(USER_ROLE.ROLE_ID, adminRoleA)
        .execute();
    return id;
  }

  private boolean globalActive(long userId) {
    return Boolean.TRUE.equals(
        dsl.select(USER.IS_ACTIVE).from(USER).where(USER.ID.eq(userId)).fetchOne(USER.IS_ACTIVE));
  }

  private String membershipStatus(long userId, long tenantId) {
    return TestFixtures.membershipStatus(dsl, userId, tenantId);
  }

  @Test
  void suspendInA_keepsGlobalAccountAndTenantB_blocksOnlyA() {
    LoginableHuman u = createLoginableHuman();
    membershipRepository.create(u.id(), tenantA, "ACTIVE");
    membershipRepository.create(u.id(), tenantB, "ACTIVE");
    // 정지 전 T_A 세션의 refresh 토큰 — 정지 후 이 토큰으로 갱신하면 T_A 를 계속 쓰면 안 된다.
    String refreshA =
        authService.selectTenant(u.id(), tenantA, AuthDetails.PASSWORD).refreshToken();

    useTenant(tenantA);
    userService.setUserActive(u.id(), false);

    // 전역 계정은 그대로, T_A 멤버십만 정지.
    assertThat(globalActive(u.id())).isTrue();
    assertThat(membershipStatus(u.id(), tenantA)).isEqualTo("SUSPENDED");
    assertThat(membershipStatus(u.id(), tenantB)).isEqualTo("ACTIVE");

    // 비밀번호 로그인 성공 + 선택 가능한 워크스페이스는 T_B 만.
    var login = authService.login(new LoginRequest(u.username(), PASSWORD));
    assertThat(login.memberships().stream().map(MembershipResponse::tenantId).toList())
        .containsExactly(tenantB);

    // T_B 선택·갱신은 정상, T_A 선택은 거부.
    String refreshB =
        authService.selectTenant(u.id(), tenantB, AuthDetails.PASSWORD).refreshToken();
    assertThat(jwtTokenProvider.getTenantIdFromToken(authService.refresh(refreshB).accessToken()))
        .isEqualTo(tenantB);
    assertThatThrownBy(() -> authService.selectTenant(u.id(), tenantA, AuthDetails.PASSWORD))
        .isInstanceOf(TenantAccessDeniedException.class);

    // 정지 전 T_A refresh 토큰은 T_A 로 재발급되지 않는다 — 로그인과 같은 규칙으로 남은 T_B 로 다시 고른다(WP-341 설계).
    assertThat(jwtTokenProvider.getTenantIdFromToken(authService.refresh(refreshA).accessToken()))
        .isEqualTo(tenantB);

    // T_A 관리자는 그 사용자를 계속 보고 다시 활성화할 수 있다.
    useTenant(tenantA);
    assertThat(userService.getUserById(u.id()).isActive()).isFalse();
    userService.setUserActive(u.id(), true);
    assertThat(membershipStatus(u.id(), tenantA)).isEqualTo("ACTIVE");
    assertThat(userService.getUserById(u.id()).isActive()).isTrue();
    assertThat(authService.selectTenant(u.id(), tenantA, AuthDetails.PASSWORD).accessToken())
        .isNotBlank();
  }

  @Test
  void suspendedInOnlyWorkspace_loginSucceedsWithNoSelectableWorkspace() {
    LoginableHuman u = createLoginableHuman();
    membershipRepository.create(u.id(), tenantA, "ACTIVE");

    useTenant(tenantA);
    userService.setUserActive(u.id(), false);

    // 활성 멤버십 0개 — 로그인은 200(500 아님), 선택 가능한 워크스페이스 없음 + tenant-less 토큰(웹이 "소속 없음" 안내).
    var login = authService.login(new LoginRequest(u.username(), PASSWORD));
    assertThat(login.memberships()).isEmpty();
    assertThat(jwtTokenProvider.getTenantIdFromToken(login.accessToken())).isNull();
  }

  @Test
  void lastAdmin_countsOnlyAdminsActiveInCurrentWorkspace() {
    long x = createAdminInA();
    long y = createAdminInA();
    membershipRepository.create(y, tenantB, "ACTIVE");

    // Y 가 T_B 에서 정지돼도 T_A 에서는 활성 ADMIN 이므로, T_A 에서 X 정지는 허용돼야 한다.
    useTenant(tenantB);
    userService.setUserActive(y, false);
    useTenant(tenantA);
    userService.setUserActive(x, false);
    assertThat(membershipStatus(x, tenantA)).isEqualTo("SUSPENDED");

    // 이제 Y 가 T_A 의 유일한 활성 ADMIN — 정지 거부.
    assertThatThrownBy(() -> userService.setUserActive(y, false))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("마지막 활성 ADMIN");
  }

  @Test
  void lastAdmin_adminSuspendedInCurrentWorkspaceIsNotCounted() {
    long x = createAdminInA();
    long y = createAdminInA();
    // Y 는 전역으로는 활성이지만 T_A 멤버십이 정지 상태 — T_A 의 활성 ADMIN 으로 세면 안 된다.
    TestFixtures.suspendMember(dsl, y, tenantA);

    useTenant(tenantA);
    assertThatThrownBy(() -> userService.setUserActive(x, false))
        .isInstanceOf(IllegalStateException.class)
        .hasMessageContaining("마지막 활성 ADMIN");
  }

  @Test
  void suspendingAlreadySuspendedLastAdmin_isIdempotentNoOp() {
    // X 가 T_A 의 유일한 ADMIN 이지만 이미 정지 상태 — 다시 끄는 것은 활성 ADMIN 수를 줄이지 않으므로 거부하지 않고 그대로 둔다.
    long x = createAdminInA();
    TestFixtures.suspendMember(dsl, x, tenantA);

    useTenant(tenantA);
    userService.setUserActive(x, false);
    assertThat(membershipStatus(x, tenantA)).isEqualTo("SUSPENDED");
  }

  @Test
  void memberDirectoryAndUserList_reflectWorkspaceMembershipStatus() {
    LoginableHuman u = createLoginableHuman();
    membershipRepository.create(u.id(), tenantA, "ACTIVE");
    membershipRepository.create(u.id(), tenantB, "ACTIVE");

    useTenant(tenantA);
    userService.setUserActive(u.id(), false);

    // T_A 기본 디렉터리(검색·담당자 후보 등)에서는 빠지고, includeInactive 에서는 active=false 로 보인다.
    assertThat(directory(u.username(), false)).isEmpty();
    MemberSummary inA = directory(u.username(), true).orElseThrow();
    assertThat(inA.active()).isFalse();
    assertThat(inA.membershipStatus()).isEqualTo("SUSPENDED");
    // T_A 사용자 관리 목록에서도 남아 있되 비활성으로.
    UserResponse listed =
        userService.getUsers(u.username(), 0, 20).content().stream()
            .filter(r -> r.id().equals(u.id()))
            .findFirst()
            .orElseThrow();
    assertThat(listed.isActive()).isFalse();

    // T_B 에서는 그대로 활성.
    useTenant(tenantB);
    assertThat(directory(u.username(), false).orElseThrow().active()).isTrue();
  }

  private Optional<MemberSummary> directory(String search, boolean includeInactive) {
    List<MemberSummary> content =
        memberDirectoryService.list(search, UserKind.ALL_FILTER, includeInactive, 0, 20).content();
    return content.stream().filter(m -> m.username().equals(search)).findFirst();
  }

  @Test
  void reAddingSuspendedMember_isRejectedWithClearConflict() {
    LoginableHuman u = createLoginableHuman();
    membershipRepository.create(u.id(), tenantA, "ACTIVE");
    useTenant(tenantA);
    userService.setUserActive(u.id(), false);

    // 운영자 콘솔 「기존 사용자 추가」 — UNIQUE 충돌 500 대신 409 + 다시 활성화 안내.
    assertThatThrownBy(
            () ->
                platformTenantService.addExistingMember(
                    tenantA, new AddExistingTenantMemberRequest(u.id(), "MEMBER")))
        .isInstanceOf(TenantMemberAlreadyExistsException.class)
        .hasMessageContaining("이 워크스페이스에서 정지된 구성원")
        .hasMessageContaining("워크스페이스 관리자가 설정 > 사용자에서 다시 활성화");
  }
}
