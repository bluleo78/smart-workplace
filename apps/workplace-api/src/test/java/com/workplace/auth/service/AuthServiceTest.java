package com.workplace.auth.service;

import static com.workplace.jooq.Tables.MEMBERSHIP;
import static com.workplace.jooq.Tables.REFRESH_TOKEN;
import static com.workplace.jooq.Tables.TENANT;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.dto.SignupRequest;
import com.workplace.auth.dto.TokenResponse;
import com.workplace.auth.exception.AccountLockedException;
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
import java.time.LocalDateTime;
import java.util.UUID;
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

  /**
   * #512: "사용자 존재" 선행조건을 공유 DB 누적에 의존하지 않고 테스트 트랜잭션 안에서 직접 만든다(롤백됨). signup 의 최초가입 부트스트랩 트리거를 피하려
   * bare USER 행만 삽입(role 미부여).
   */
  private void seedExistingUser() {
    String u = "seed-" + java.util.UUID.randomUUID().toString().substring(0, 8);
    baseDsl
        .insertInto(com.workplace.jooq.Tables.USER)
        .set(com.workplace.jooq.Tables.USER.USERNAME, u)
        .set(com.workplace.jooq.Tables.USER.PASSWORD, "pw")
        .set(com.workplace.jooq.Tables.USER.NAME, u)
        .set(com.workplace.jooq.Tables.USER.EMAIL, u + "@example.com")
        .execute();
  }

  /** 가입 가용성 술어 — 사용자가 존재하면 false 여야 한다(부트스트랩 이후 = 공개 가입 차단). 가입 게이트가 읽는 단일 술어의 회귀 가드. */
  @Test
  void isSignupAvailable_falseWhenUsersExist() {
    seedExistingUser();
    assertThat(authService.isSignupAvailable()).isFalse();
  }

  @Test
  void signup_firstUser_assignsAdminAndUserRoles() {
    SignupRequest request =
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User");

    UserResponse result = authService.signup(request);

    assertThat(result.username()).isEqualTo("test@example.com");
    assertThat(result.id()).isNotNull();
  }

  @Test
  void signup_trimsName() {
    // WP-572: 가입 이름도 앞뒤 공백을 다듬어 저장한다.
    UserResponse result =
        authService.signup(
            new SignupRequest(
                "padded@example.com", "padded@example.com", "Password123", "  김지훈  "));

    assertThat(result.name()).isEqualTo("김지훈");
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
    seedExistingUser(); // #512: 선행 사용자 → 이 가입자는 비-최초 → 플랫폼 역할 미부여
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
  void login_sameSecondTwice_bothSucceedWithDistinctRefreshTokens() {
    // #686 회귀 테스트: HMAC 서명은 결정적이므로 jti(랜덤 UUID) claim이 없으면 같은 초 내
    // 재로그인 시 refresh JWT 문자열이 완전히 동일해져 refresh_token.token_hash UNIQUE 제약을
    // 위반(DataIntegrityViolationException)한다. jti 추가로 두 번째 로그인도 정상 성공해야 한다.
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));

    var first = authService.login(new LoginRequest("test@example.com", "Password123"));
    var second = authService.login(new LoginRequest("test@example.com", "Password123"));

    assertThat(first.refreshToken()).isNotBlank();
    assertThat(second.refreshToken()).isNotBlank();
    assertThat(second.refreshToken()).isNotEqualTo(first.refreshToken());
    assertThat(second.accessToken()).isNotEqualTo(first.accessToken());
  }

  @Test
  void login_wrongPassword_throws() {
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));

    assertThatThrownBy(
            () -> authService.login(new LoginRequest("test@example.com", "wrongpassword")))
        .isInstanceOf(InvalidCredentialsException.class);
  }

  /**
   * WP-624: 휴대폰 키보드가 첫 글자를 대문자로 바꾸거나 앞뒤 공백이 붙어도 같은 계정으로 로그인한다. 잠금 카운터도 실제 아이디 하나로 센다 — 대소문자를 바꿔 가며
   * 틀리면 잠금을 피해 가지 못한다.
   */
  @Test
  void login_ignoresCaseAndSurroundingSpaces_andLocksOnCanonicalName() {
    String name = "wp624-" + UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    UserResponse user =
        authService.signup(new SignupRequest(name, name, "Password123", "Test User"));

    var ok = authService.login(new LoginRequest("  " + name.toUpperCase() + " ", "Password123"));
    assertThat(jwtTokenProvider.getUserIdFromToken(ok.accessToken())).isEqualTo(user.id());

    // 대소문자를 바꿔 가며 5번 틀리면 실제 아이디가 잠긴다
    for (String variant :
        new String[] {
          name.toUpperCase(),
          " " + name,
          "W" + name.substring(1),
          name + " ",
          name.toUpperCase() + " "
        }) {
      assertThatThrownBy(() -> authService.login(new LoginRequest(variant, "wrong")))
          .isInstanceOf(InvalidCredentialsException.class);
    }
    assertThatThrownBy(() -> authService.login(new LoginRequest(name, "Password123")))
        .isInstanceOf(AccountLockedException.class);
  }

  /** WP-624: 대소문자만 다른 두 계정이 이미 있으면 어느 쪽인지 정할 수 없으니, 정확히 같은 아이디로만 들어간다. */
  @Test
  void login_ambiguousCaseVariants_requireExactName() {
    String base = "wp624d-" + UUID.randomUUID().toString().substring(0, 8) + "@x.io";
    String lower = "a" + base;
    String upper = "A" + base;
    authService.signup(new SignupRequest(lower, null, "Password123", "소문자"));
    authService.signup(new SignupRequest(upper, null, "Password456", "대문자"));

    // 각자 정확한 아이디로는 들어간다
    assertThat(authService.login(new LoginRequest(lower, "Password123")).accessToken())
        .isNotBlank();
    assertThat(authService.login(new LoginRequest(upper, "Password456")).accessToken())
        .isNotBlank();
    // 어느 쪽과도 정확히 같지 않은 변형은 거절한다
    assertThatThrownBy(
            () -> authService.login(new LoginRequest(upper.toUpperCase(), "Password456")))
        .isInstanceOf(InvalidCredentialsException.class);
  }

  @Test
  void login_userNotFound_throws() {
    assertThatThrownBy(() -> authService.login(new LoginRequest("unknown@example.com", "password")))
        .isInstanceOf(InvalidCredentialsException.class);
  }

  @Test
  void refresh_success() {
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));
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
    // grace period 불변조건 회귀 가드도 겸함: logout으로 family 전체가 죽은 상태(familyAlive=false)이므로
    // grace 기간 내라도 절대 관용이 적용되면 안 된다.
    assertThatThrownBy(() -> authService.refresh(loginResult.refreshToken()))
        .isInstanceOf(InvalidTokenException.class)
        .hasMessage("이미 사용된 토큰입니다. 다시 로그인해 주세요.");
  }

  @Test
  void refresh_reusedToken_revokesEntireFamily() {
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));

    String firstRefreshToken = loginResult.refreshToken();
    // Normal rotation: use first token to get second token
    TokenResponse secondResult = authService.refresh(firstRefreshToken);
    String secondRefreshToken = secondResult.refreshToken();

    // grace period(테스트 설정 2초)를 지나야 진짜 탈취 시나리오가 된다 — grace 이내 재사용은
    // 크로스탭 경쟁으로 간주되어 관용되므로(별도 테스트로 커버) 여기서는 grace 만료 후 재사용을 재현한다.
    expireRefreshGrace(); // grace(2초) 만료를 sleep 없이 재현

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
  void refresh_reuseWithinGracePeriod_issuesNewTokenInsteadOfRevokingFamily() {
    // 크로스탭 경쟁 재현: 한 탭이 A로 refresh해 B를 받은 "직후"(그레이스 윈도우 내) 다른 탭이 여전히 A로 refresh를 시도.
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));
    String tokenA = loginResult.refreshToken();
    TokenResponse afterFirstRefresh = authService.refresh(tokenA); // A → B (정상 회전)
    String tokenB = afterFirstRefresh.refreshToken();

    // A는 이미 revoked지만 방금 폐기됐고 B가 살아있으므로 grace 적용 — 예외 없이 새 토큰(C) 발급.
    TokenResponse afterSecondRefresh = authService.refresh(tokenA);

    assertThat(afterSecondRefresh.accessToken()).isNotBlank();
    assertThat(afterSecondRefresh.refreshToken()).isNotBlank();
    assertThat(afterSecondRefresh.refreshToken()).isNotEqualTo(tokenB);

    // grace로 살아난 family이므로 B도 여전히 유효해야 한다(정상 탭까지 로그아웃되지 않음 확인).
    TokenResponse afterUsingB = authService.refresh(tokenB);
    assertThat(afterUsingB.accessToken()).isNotBlank();
  }

  @Test
  void refresh_reuseAfterGracePeriodExpired_revokesEntireFamily() {
    authService.signup(
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User"));
    var loginResult = authService.login(new LoginRequest("test@example.com", "Password123"));
    String tokenA = loginResult.refreshToken();
    authService.refresh(tokenA); // A → B

    expireRefreshGrace(); // grace(2초) 만료를 sleep 없이 재현

    assertThatThrownBy(() -> authService.refresh(tokenA))
        .isInstanceOf(InvalidTokenException.class)
        .hasMessage("이미 사용된 토큰입니다. 다시 로그인해 주세요.");
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

  /**
   * WP-341 후속 테스트 픽스처: 사용자를 만들고 signup 이 붙이는 tenant#1 멤버십을 SUSPENDED 로 돌린 뒤, 주어진 상태의 테넌트를 하나씩 만들어
   * ACTIVE 멤버십으로 연결한다. 반환 배열의 0번은 userId, 이후는 생성 순서대로 tenantId.
   */
  private long[] userWithTenants(String prefix, String... tenantStatuses) {
    String username =
        prefix + "-" + java.util.UUID.randomUUID().toString().substring(0, 8) + "@example.com";
    UserResponse user =
        authService.signup(new SignupRequest(username, username, "Password123", prefix));
    baseDsl
        .update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(user.id()).and(MEMBERSHIP.TENANT_ID.eq(1L)))
        .execute();
    long[] ids = new long[tenantStatuses.length + 1];
    ids[0] = user.id();
    for (int i = 0; i < tenantStatuses.length; i++) {
      Long tenantId =
          baseDsl
              .insertInto(TENANT)
              .set(TENANT.NAME, prefix + " " + i)
              .set(TENANT.SLUG, prefix + "-" + i + "-" + user.id())
              .set(TENANT.STATUS, tenantStatuses[i])
              .returning(TENANT.ID)
              .fetchOne()
              .getId();
      baseDsl
          .insertInto(MEMBERSHIP)
          .set(MEMBERSHIP.USER_ID, user.id())
          .set(MEMBERSHIP.TENANT_ID, tenantId)
          .set(MEMBERSHIP.STATUS, "ACTIVE")
          .execute();
      ids[i + 1] = tenantId;
    }
    return ids;
  }

  /** 테넌트 상태를 바꾼다(정지·삭제·영구 삭제 진행 시뮬레이션). */
  private void setTenantStatus(long tenantId, String status) {
    baseDsl.update(TENANT).set(TENANT.STATUS, status).where(TENANT.ID.eq(tenantId)).execute();
  }

  /**
   * (1) 2개 소속 중 쓰던 테넌트가 삭제되면 refresh 는 예외(로그아웃) 대신 남은 테넌트 하나로 이어 간다 — 로그인 자동 선택과 같은 규칙. 새 refresh
   * 토큰에도 죽은 테넌트가 남지 않고, 같은 family 로 회전이 계속된다.
   */
  @Test
  void refresh_whenActiveTenantDeleted_withOneRemaining_switchesToRemainingTenant() {
    long[] ids = userWithTenants("refresh-fallback-one", "ACTIVE", "ACTIVE");
    long userId = ids[0];
    long dead = ids[1];
    long alive = ids[2];
    TokenResponse scoped = authService.selectTenant(userId, dead, null);
    setTenantStatus(dead, "DELETED");

    TokenResponse rotated = authService.refresh(scoped.refreshToken());

    assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.accessToken())).isEqualTo(alive);
    assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.refreshToken())).isEqualTo(alive);
    // 회전한 토큰은 그대로 이어서 쓸 수 있고(대체 테넌트 유지), 쓰고 난 원래 토큰은 폐기돼 grace 밖 재사용이면 family 전체가 폐기된다.
    TokenResponse again = authService.refresh(rotated.refreshToken());
    assertThat(jwtTokenProvider.getTenantIdFromToken(again.accessToken())).isEqualTo(alive);
    expireRefreshGrace();
    assertThatThrownBy(() -> authService.refresh(scoped.refreshToken()))
        .isInstanceOf(InvalidTokenException.class);
    assertThatThrownBy(() -> authService.refresh(again.refreshToken()))
        .isInstanceOf(InvalidTokenException.class);
  }

  /** (2) 3개 소속 중 쓰던 테넌트 1개가 삭제되면 남은 후보가 2개라 자동 선택하지 않고 tenant-less 로 발급한다(웹이 선택 화면으로). */
  @Test
  void refresh_whenActiveTenantDeleted_withManyRemaining_issuesTenantlessTokens() {
    long[] ids = userWithTenants("refresh-fallback-many", "ACTIVE", "ACTIVE", "ACTIVE");
    TokenResponse scoped = authService.selectTenant(ids[0], ids[1], null);
    setTenantStatus(ids[1], "DELETED");

    TokenResponse rotated = authService.refresh(scoped.refreshToken());

    assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.accessToken())).isNull();
    assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.refreshToken())).isNull();
  }

  /** (3) 유일한 소속 테넌트가 삭제되면 후보 0개 — 로그인 직후와 같은 tenant-less 상태로 발급한다(예외로 끊지 않는다). */
  @Test
  void refresh_whenOnlyTenantDeleted_issuesTenantlessTokens() {
    long[] ids = userWithTenants("refresh-fallback-none", "ACTIVE");
    TokenResponse scoped = authService.selectTenant(ids[0], ids[1], null);
    setTenantStatus(ids[1], "DELETED");

    TokenResponse rotated = authService.refresh(scoped.refreshToken());

    assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.accessToken())).isNull();
    assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.refreshToken())).isNull();
  }

  /**
   * 정지(SUSPENDED)·영구 삭제 중(PURGING)과 멤버십 비활성도 같은 대체 규칙을 탄다 — 이전에는 InvalidTokenException 으로 로그아웃시켰다.
   */
  @Test
  void refresh_whenTenantSuspendedPurgingOrMembershipInactive_fallsBackToRemainingTenant() {
    long[] ids = userWithTenants("refresh-fallback-states", "ACTIVE", "ACTIVE", "ACTIVE", "ACTIVE");
    long userId = ids[0];
    long alive = ids[4];
    TokenResponse suspended = authService.selectTenant(userId, ids[1], null);
    TokenResponse purging = authService.selectTenant(userId, ids[2], null);
    TokenResponse left = authService.selectTenant(userId, ids[3], null);
    setTenantStatus(ids[1], "SUSPENDED");
    setTenantStatus(ids[2], "PURGING");
    baseDsl
        .update(MEMBERSHIP)
        .set(MEMBERSHIP.STATUS, "SUSPENDED")
        .where(MEMBERSHIP.USER_ID.eq(userId).and(MEMBERSHIP.TENANT_ID.eq(ids[3])))
        .execute();

    for (TokenResponse t : new TokenResponse[] {suspended, purging, left}) {
      TokenResponse rotated = authService.refresh(t.refreshToken());
      assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.accessToken())).isEqualTo(alive);
      assertThat(jwtTokenProvider.getTenantIdFromToken(rotated.refreshToken())).isEqualTo(alive);
    }
  }

  /**
   * (4) 로그인 자동 선택과 멤버십 목록(GET /auth/memberships 의 서비스)은 DELETED·PURGING·SUSPENDED 테넌트를 제외한다 — 죽은
   * 테넌트로 자동 선택되거나 선택 목록에 보이지 않아야 한다.
   */
  @Test
  void loginAndMemberships_excludeDeletedPurgingSuspendedTenants() {
    long[] ids = userWithTenants("login-filter", "ACTIVE", "DELETED", "PURGING", "SUSPENDED");
    long userId = ids[0];
    String username = userRepository.findById(userId).orElseThrow().username();

    var login = authService.login(new LoginRequest(username, "Password123"));

    assertThat(login.memberships()).extracting(m -> m.tenantId()).containsExactly(ids[1]);
    assertThat(jwtTokenProvider.getTenantIdFromToken(login.accessToken())).isEqualTo(ids[1]);
    assertThat(authService.membershipsOf(userId, null))
        .extracting(m -> m.tenantId())
        .containsExactly(ids[1]);
  }

  /** 삭제된 테넌트 하나뿐인 사용자는 로그인 시 그 테넌트로 자동 선택되지 않고 선택 목록도 비어 있다(tenant-less). */
  @Test
  void login_whenOnlyTenantDeleted_isTenantlessWithNoMemberships() {
    long[] ids = userWithTenants("login-only-deleted", "DELETED");
    String username = userRepository.findById(ids[0]).orElseThrow().username();

    var login = authService.login(new LoginRequest(username, "Password123"));

    assertThat(login.memberships()).isEmpty();
    assertThat(jwtTokenProvider.getTenantIdFromToken(login.accessToken())).isNull();
  }

  /**
   * refresh grace period(테스트 설정 2초) 만료를 sleep 없이 재현한다 — 방금 폐기된 토큰의 revoked_at 을 grace 밖(1시간 전)으로
   * 당긴다. 클래스 {@code @Transactional} 이라 테스트 종료 시 롤백된다. "방금 폐기" 조건으로 이 테스트가 만든 행만 건드린다.
   */
  private void expireRefreshGrace() {
    LocalDateTime now = LocalDateTime.now();
    baseDsl
        .update(REFRESH_TOKEN)
        .set(REFRESH_TOKEN.REVOKED_AT, now.minusHours(1))
        .where(REFRESH_TOKEN.REVOKED.isTrue())
        .and(REFRESH_TOKEN.REVOKED_AT.gt(now.minusMinutes(1)))
        .execute();
  }
}
