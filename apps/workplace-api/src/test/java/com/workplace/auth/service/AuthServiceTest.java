package com.workplace.auth.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.dto.SignupRequest;
import com.workplace.auth.dto.TokenResponse;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.platform.repository.PlatformRoleRepository;
import com.workplace.support.IntegrationTestBase;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserDeactivatedException;
import com.workplace.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.context.jdbc.SqlConfig;
import org.springframework.transaction.annotation.Transactional;

/**
 * 테스트 격리: LoginAttemptRepository.incrementAttempts/clear가 REQUIRES_NEW로 독립 커밋하므로 테스트 @Transactional
 * 롤백을 빠져나가 login_attempts 테이블에 잔존 → 다음 실행 시 unknown@example.com이 잠금 상태로 시작해
 * InvalidCredentialsException 대신 AccountLockedException 반환(#flaky). 매 테스트 전 ISOLATED 트랜잭션으로 테이블을
 * 비운다.
 */
@Transactional
@Sql(
    statements = "DELETE FROM login_attempts",
    config = @SqlConfig(transactionMode = SqlConfig.TransactionMode.ISOLATED),
    executionPhase = Sql.ExecutionPhase.BEFORE_TEST_METHOD)
class AuthServiceTest extends IntegrationTestBase {

  @Autowired private AuthService authService;

  @Autowired private UserRepository userRepository;

  @Autowired private JwtTokenProvider jwtTokenProvider;

  @Autowired private PlatformRoleRepository platformRoleRepository;

  @Test
  void signup_firstUser_assignsAdminAndUserRoles() {
    SignupRequest request =
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User");

    UserResponse result = authService.signup(request);

    assertThat(result.username()).isEqualTo("test@example.com");
    assertThat(result.id()).isNotNull();
  }

  @Test
  void signup_subsequentUser_assignsUserRoleOnly() {
    authService.signup(
        new SignupRequest("first@example.com", "first@example.com", "Password123", "First User"));

    SignupRequest request =
        new SignupRequest("second@example.com", "second@example.com", "Password123", "Second User");
    UserResponse result = authService.signup(request);

    assertThat(result.username()).isEqualTo("second@example.com");
  }

  /**
   * 회귀 가드: 일반(비-최초) 가입자는 플랫폼 역할을 절대 부여받지 않아야 한다. SUPER_ADMIN 부트스트랩 호출이 {@code isFirstUser} 블록 밖으로
   * 새면 모든 가입자가 슈퍼 관리자가 되는 치명적 결함을 잡는다.
   *
   * <p>(공유 테스트 DB 는 비어 있지 않아 {@code countAll != 0} → isFirstUser=false 이므로, 최초 가입자 양성 경로는 통합 테스트로
   * 단언 불가. 최초 가입 부여의 정상 동작은 PlatformRoleRepositoryTest 의 assignSuperAdmin 단위 커버리지 +
   * AuthService.signup 의 배치 검수로 보장한다.)
   */
  @Test
  void signup_subsequentUser_doesNotGrantPlatformRole() {
    UserResponse result =
        authService.signup(
            new SignupRequest(
                "normal-user@example.com",
                "normal-user@example.com",
                "Password123",
                "Normal User"));

    assertThat(platformRoleRepository.hasAnyPlatformRole(result.id())).isFalse();
  }

  @Test
  void signup_duplicateUsername_throws() {
    authService.signup(
        new SignupRequest("test@example.com", "test1@example.com", "Password123", "Test User"));

    assertThatThrownBy(
            () ->
                authService.signup(
                    new SignupRequest(
                        "test@example.com", "test2@example.com", "Password123", "Test User 2")))
        .isInstanceOf(UsernameAlreadyExistsException.class);
  }

  @Test
  void signup_duplicateEmail_throws() {
    authService.signup(
        new SignupRequest("user1@example.com", "same@example.com", "Password123", "User 1"));

    assertThatThrownBy(
            () ->
                authService.signup(
                    new SignupRequest(
                        "user2@example.com", "same@example.com", "Password123", "User 2")))
        .isInstanceOf(EmailAlreadyExistsException.class);
  }

  @Test
  void signup_nullEmail_success() {
    SignupRequest request = new SignupRequest("test@example.com", null, "Password123", "Test User");

    UserResponse result = authService.signup(request);

    assertThat(result.username()).isEqualTo("test@example.com");
  }

  @Test
  void login_success() {
    UserResponse user =
        authService.signup(
            new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    // signup 이 자동 생성하는 tenant#1 멤버십을 SUSPENDED 로 — app_tenant 는 membership DELETE 불가(V46)이나
    // UPDATE 는 가능. findActiveByUser 는 ACTIVE 만 보므로 활성 멤버십 0 → tenant-less 분기 검증.
    baseDsl
        .update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(user.id()).and(MEMBERSHIP.TENANT_ID.eq(1L)))
        .execute();

    var result = authService.login(new LoginRequest("test@example.com", "Password123"));

    assertThat(result.accessToken()).isNotBlank();
    assertThat(result.refreshToken()).isNotBlank();
    assertThat(result.expiresIn()).isGreaterThan(0);
    // 1단계 로그인은 tenant-less 토큰 + 선택 가능한 멤버십을 반환한다(여기선 멤버십 없음 = 빈 목록).
    assertThat(result.memberships()).isNotNull();
    // 0 멤버십 → 자동 선택 불가 → tenant-less 토큰(0/1/2 분기 커버리지 잠금).
    assertThat(jwtTokenProvider.getTenantIdFromToken(result.accessToken())).isNull();
  }

  @Test
  void login_wrongPassword_throws() {
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));

    assertThatThrownBy(
            () -> authService.login(new LoginRequest("test@example.com", "wrongpassword")))
        .isInstanceOf(InvalidCredentialsException.class);
  }

  @Test
  void login_userNotFound_throws() {
    assertThatThrownBy(() -> authService.login(new LoginRequest("unknown@example.com", "password")))
        .isInstanceOf(InvalidCredentialsException.class);
  }

  @Test
  void refresh_success() throws InterruptedException {
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));

    Thread.sleep(1100); // JWT uses second-precision timestamps; ensure new token differs

    TokenResponse result = authService.refresh(loginResult.refreshToken());

    assertThat(result.accessToken()).isNotBlank();
    assertThat(result.refreshToken()).isNotBlank();
    assertThat(result.accessToken()).isNotEqualTo(loginResult.accessToken());
  }

  @Test
  void refresh_invalidToken_throws() {
    assertThatThrownBy(() -> authService.refresh("invalid-token"))
        .isInstanceOf(InvalidTokenException.class);
  }

  @Test
  void refresh_revokedToken_throws() {
    UserResponse user =
        authService.signup(
            new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));

    // Logout revokes all tokens
    authService.logout(user.id());

    // Try to use the revoked refresh token — reuse detection kicks in
    assertThatThrownBy(() -> authService.refresh(loginResult.refreshToken()))
        .isInstanceOf(InvalidTokenException.class)
        .hasMessage("이미 사용된 토큰입니다. 다시 로그인해 주세요.");
  }

  @Test
  void refresh_reusedToken_revokesEntireFamily() throws InterruptedException {
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));

    String firstRefreshToken = loginResult.refreshToken();

    Thread.sleep(1100);

    // Normal rotation: use first token to get second token
    TokenResponse secondResult = authService.refresh(firstRefreshToken);
    String secondRefreshToken = secondResult.refreshToken();

    // Simulate attacker reusing the first (already rotated) token
    // This should revoke the entire token family, including the second token
    assertThatThrownBy(() -> authService.refresh(firstRefreshToken))
        .isInstanceOf(InvalidTokenException.class)
        .hasMessage("이미 사용된 토큰입니다. 다시 로그인해 주세요.");

    // The legitimate second token should also be revoked (family revocation)
    assertThatThrownBy(() -> authService.refresh(secondRefreshToken))
        .isInstanceOf(InvalidTokenException.class);
  }

  @Test
  void logout_revokesAllTokens() {
    UserResponse user =
        authService.signup(
            new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));

    authService.logout(user.id());

    assertThatThrownBy(() -> authService.refresh(loginResult.refreshToken()))
        .isInstanceOf(InvalidTokenException.class);
  }

  @Test
  void refresh_deactivatedUser_throws() {
    UserResponse user =
        authService.signup(
            new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));

    userRepository.setActive(user.id(), false);

    assertThatThrownBy(() -> authService.refresh(loginResult.refreshToken()))
        .isInstanceOf(UserDeactivatedException.class)
        .hasMessage("비활성화된 계정입니다.");
  }

  @Test
  void getCurrentUser_success() {
    UserResponse created =
        authService.signup(
            new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));

    UserResponse result = authService.getCurrentUser(created.id());

    assertThat(result.id()).isEqualTo(created.id());
    assertThat(result.username()).isEqualTo("test@example.com");
  }

  /**
   * 단일 멤버십 → tenant-scoped 토큰 자동 발급. 신규 사용자를 만들고 테넌트 1개를 연결한 뒤 로그인했을 때, accessToken 에 테넌트 클레임이
   * 포함되는지 검증한다.
   */
  @Test
  void login_withSingleMembership_issuesTenantScopedToken() {
    // 사용자 생성
    UserResponse user =
        authService.signup(
            new SignupRequest(
                "single-member@example.com",
                "single-member@example.com",
                "Password123",
                "Single Member"));
    // signup 이 자동 생성하는 tenant#1 멤버십을 SUSPENDED 로 → 아래 단일 테넌트만 활성으로 남겨 1 멤버십(tenant-scoped) 분기 검증.
    baseDsl
        .update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(user.id()).and(MEMBERSHIP.TENANT_ID.eq(1L)))
        .execute();

    // 테넌트 1개 생성
    Long tenantId =
        baseDsl
            .insertInto(TENANT)
            .set(TENANT.NAME, "Test Tenant Single")
            .set(TENANT.SLUG, "test-tenant-single-" + user.id())
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    // 해당 사용자에게 멤버십 연결
    baseDsl
        .insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, user.id())
        .set(MEMBERSHIP.TENANT_ID, tenantId)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();

    // 로그인 — 단일 멤버십이므로 즉시 tenant-scoped 토큰 발급
    var result = authService.login(new LoginRequest("single-member@example.com", "Password123"));

    assertThat(jwtTokenProvider.getTenantIdFromToken(result.accessToken())).isEqualTo(tenantId);
    assertThat(result.memberships()).hasSize(1);
  }

  /**
   * 다중 멤버십 → tenant-less 토큰 유지. 사용자에게 테넌트 2개를 연결한 뒤 로그인했을 때, tenant 클레임이 null(tenant-less)이어야 한다.
   */
  @Test
  void login_withMultipleMemberships_issuesTenantlessToken() {
    // 사용자 생성
    UserResponse user =
        authService.signup(
            new SignupRequest(
                "multi-member@example.com",
                "multi-member@example.com",
                "Password123",
                "Multi Member"));
    // signup 이 자동 생성하는 tenant#1 멤버십을 SUSPENDED 로 → 아래 두 테넌트만 활성으로 남겨 2 멤버십(tenant-less) 분기 검증.
    baseDsl
        .update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(user.id()).and(MEMBERSHIP.TENANT_ID.eq(1L)))
        .execute();

    // 테넌트 2개 생성
    Long tenantId1 =
        baseDsl
            .insertInto(TENANT)
            .set(TENANT.NAME, "Test Tenant Multi 1")
            .set(TENANT.SLUG, "test-tenant-multi1-" + user.id())
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    Long tenantId2 =
        baseDsl
            .insertInto(TENANT)
            .set(TENANT.NAME, "Test Tenant Multi 2")
            .set(TENANT.SLUG, "test-tenant-multi2-" + user.id())
            .set(TENANT.STATUS, "ACTIVE")
            .returning(TENANT.ID)
            .fetchOne()
            .getId();

    // 두 멤버십 모두 연결
    baseDsl
        .insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, user.id())
        .set(MEMBERSHIP.TENANT_ID, tenantId1)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();

    baseDsl
        .insertInto(MEMBERSHIP)
        .set(MEMBERSHIP.USER_ID, user.id())
        .set(MEMBERSHIP.TENANT_ID, tenantId2)
        .set(MEMBERSHIP.STATUS, "ACTIVE")
        .execute();

    // 로그인 — 다중 멤버십이므로 tenant-less 토큰 유지
    var result = authService.login(new LoginRequest("multi-member@example.com", "Password123"));

    assertThat(jwtTokenProvider.getTenantIdFromToken(result.accessToken())).isNull();
    assertThat(result.memberships()).hasSize(2);
    // @Transactional 클래스 어노테이션으로 테스트 종료 시 롤백 — 별도 cleanup 불필요.
  }
}
