package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.dto.SignupRequest;
import com.workplace.auth.dto.TokenResponse;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.exception.RefreshTokenReuseException;
import com.workplace.auth.exception.TenantAccessDeniedException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.auth.repository.RefreshTokenRepository;
import com.workplace.global.exception.CryptoException;
import com.workplace.global.security.AuthDetails;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.global.tenant.DefaultTenant;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.PersonNames;
import com.workplace.global.util.RequestInfo;
import com.workplace.global.util.Texts;
import com.workplace.role.exception.RoleNotFoundException;
import com.workplace.role.repository.RoleRepository;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.tenant.repository.TenantRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserDeactivatedException;
import com.workplace.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

@Service
@RequiredArgsConstructor
public class AuthService {

  private final UserRepository userRepository;
  private final RoleRepository roleRepository;
  private final PasswordEncoder passwordEncoder;
  private final JwtTokenProvider jwtTokenProvider;
  private final JwtProperties jwtProperties;
  private final RefreshTokenRepository refreshTokenRepository;
  private final LoginAttemptService loginAttemptService;
  private final PasswordLoginVerifier passwordLoginVerifier;
  private final LoginFailureAuditor loginFailureAuditor;
  private final AuditLogService auditLogService;
  private final MembershipRepository membershipRepository;
  private final TenantRepository tenantRepository;
  // 최초 가입자 부트스트랩용 플랫폼 RBAC 저장소. platform 모듈 의존이지만 DSLContext 만 참조하므로
  // 순환 빈 의존이 없다(AuthService → PlatformRoleRepository → DSLContext).
  private final com.workplace.platform.repository.PlatformRoleRepository platformRoleRepository;

  /** 로그인의 발급 단계만 트랜잭션으로 묶는다(WP-752 — 자격 검증은 트랜잭션 밖). */
  private final TransactionTemplate tx;

  /** WP-48: SSO 로그인 결과 — refresh 토큰(쿠키로 설정)과 자동 선택된 테넌트(없으면 null). */
  public record SsoSession(String refreshToken, Long tenantId) {}

  /** 1단계 로그인 결과(내부 운반용): accessToken/refreshToken 분리 + 선택 가능한 멤버십. */
  public record LoginResult(
      String accessToken,
      String refreshToken,
      long expiresIn,
      List<MembershipResponse> memberships) {}

  /**
   * 공개 셀프 회원가입 허용 여부 — 사용자가 한 명도 없을 때(부트스트랩)만 true.
   *
   * <p>가입 게이트(컨트롤러)와 가용성 조회 엔드포인트, 웹 가입 화면이 모두 이 단일 술어를 읽어 "가능 여부" 판정을 일원화한다(표시·집행 분기 방지). {@code
   * user} 는 전역(RLS 비대상) 테이블이라 테넌트 컨텍스트 없이 집계 가능하다.
   */
  @Transactional(readOnly = true)
  public boolean isSignupAvailable() {
    return userRepository.countAll(null) == 0;
  }

  @Transactional
  public UserResponse signup(SignupRequest request) {
    if (userRepository.existsByUsername(request.username())) {
      // 사용자에게 한국어 메시지 반환 — 영문 원문 메시지 노출 방지
      throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
    }
    // WP-1098: 빈 이메일은 「이메일 없음」(null)으로 저장한다 — '' 를 그대로 저장하면 다음에 빈 이메일로 가입하는 사람이 '' 끼리 겹쳤다.
    String email = Texts.blankToNull(request.email());
    if (email != null && userRepository.existsByEmail(email)) {
      // 사용자에게 한국어 메시지 반환 — 영문 원문 메시지 노출 방지
      throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }

    userRepository.acquireFirstUserLock();
    boolean isFirstUser = userRepository.countAll(null) == 0;

    String encodedPassword = passwordEncoder.encode(request.password());
    // WP-572: 이름 앞뒤 공백·보이지 않는 문자를 다듬고, 비거나 제어 문자가 섞인 이름은 거절한다.
    UserResponse user =
        userRepository.save(
            request.username(), email, encodedPassword, PersonNames.normalize(request.name()));

    // Assign roles: first user gets ADMIN + USER, subsequent users get USER only
    Long userRoleId =
        roleRepository
            .findByName("USER")
            .orElseThrow(() -> new RoleNotFoundException("시스템 역할을 찾을 수 없습니다 (name: USER)"))
            .id();
    userRepository.addRole(user.id(), userRoleId);

    if (isFirstUser) {
      Long adminRoleId =
          roleRepository
              .findByName("ADMIN")
              .orElseThrow(() -> new RoleNotFoundException("시스템 역할을 찾을 수 없습니다 (name: ADMIN)"))
              .id();
      userRepository.addRole(user.id(), adminRoleId);

      // 최초 가입자를 플랫폼 슈퍼 관리자로 부트스트랩 — 운영자 콘솔의 첫 접근 주체.
      // platform_user_role 은 전역 테이블(RLS 비대상)이라 tenant#1 컨텍스트에서도 삽입 가능.
      platformRoleRepository.assignSuperAdmin(user.id());
    }

    // 신규 사용자에게 tenant#1 멤버십을 생성한다 — 그래야 로그인 시 단일 멤버십이 자동 선택되어
    // tenant-scoped 토큰이 발급되고(도메인 RLS 하에서도 정상 동작), 사용자가 실제로 사용 가능해진다.
    // (과도기 모델: 모든 신규 사용자는 tenant#1 에 귀속. 멀티테넌트 셀프-가입/초대는 후속 P3/§8.)
    membershipRepository.create(user.id(), DefaultTenant.ID, "ACTIVE");

    return user;
  }

  /**
   * 비밀번호 로그인.
   *
   * <p>자격 검증은 트랜잭션 밖에서 한다(WP-752). 검증 단계가 커넥션을 쥐면 실패 카운터 기록이 두 번째 커넥션을 빌려야 해, 인증 없이 틀린 로그인만 풀 크기만큼
   * 동시에 보내도 풀이 교착됐다. 밖에서는 조회·카운터 기록이 각자 커넥션 하나를 잠깐 쓰고 돌려주며, 비밀번호 해시 계산 동안 커넥션을 쥐지도 않는다. 토큰 발급·저장과
   * 감사는 그 뒤 트랜잭션 하나로 한다.
   */
  public LoginResult login(LoginRequest request) {
    // 잠금·자격 검증 — 실패는 모두 같은 문구·같은 해시 계산 시간(WP-623, PasswordLoginVerifier).
    // 있는 계정의 실패는 감사 로그 「로그인 실패」로 남긴다(WP-1152) — 기록은 요청 스레드 밖에서 해 응답 시간이 갈리지 않는다.
    // 요청 정보(IP·UA)는 계정이 있든 없든 검증 전에 뽑는다 — 있는 계정에서만 뽑으면 그만큼 응답 시간이 갈린다(WP-1161).
    RequestInfo requestInfo = RequestInfo.current();
    UserResponse user =
        passwordLoginVerifier.verify(
            request.username(),
            request.password(),
            (failed, reason) -> loginFailureAuditor.recordFailed(failed, reason, requestInfo));

    if (!user.isActive()) {
      // 비활성화된 계정 접근 시 한국어 메시지 반환
      throw new UserDeactivatedException("비활성화된 계정입니다.");
    }

    // 실패 카운터는 실제 아이디로 센다(WP-624) — 입력값이 아니라 검증된 사용자의 아이디로 초기화한다
    loginAttemptService.loginSucceeded(user.username());

    return tx.execute(status -> issueLogin(user));
  }

  /** 검증된 사용자에게 토큰을 발급·저장하고 로그인 감사를 남긴다 — {@link #login} 의 트랜잭션 부분. */
  private LoginResult issueLogin(UserResponse user) {
    // 활성 멤버십을 먼저 조회 — 정확히 1개면 자동 선택해 tenant-scoped 토큰 발급.
    // (P3 테넌트 선택 UI 전까지 단일 소속 사용자가 도메인 RLS 하에서도 정상 동작하도록.)
    var memberships = membershipRepository.findActiveByUser(user.id());
    Long autoTenantId = memberships.size() == 1 ? memberships.get(0).tenantId() : null;

    String accessToken =
        jwtTokenProvider.generateAccessToken(user.id(), user.username(), autoTenantId);
    String refreshToken = jwtTokenProvider.generateRefreshToken(user.id(), autoTenantId);

    UUID familyId = UUID.randomUUID();
    storeRefreshToken(user.id(), refreshToken, familyId);

    // 로그인 감사 로그 (#60/#92) — 바로 들어간 워크스페이스가 있으면 그 워크스페이스에 남긴다(WP-598).
    logLogin(user, autoTenantId, "로그인 성공", null);

    return new LoginResult(
        accessToken, refreshToken, jwtProperties.accessExpiration() / 1000, memberships);
  }

  /**
   * 2단계: 테넌트 선택 → membership+tenant ACTIVE 검증 후 tenant 스코프 토큰 발급. 전환도 이 메서드.
   *
   * <p>WP-48: authMethod=sso 세션은 SSO 가 켜진 워크스페이스만 선택할 수 있다. 새로 발급하는 토큰에도 amr 을 유지해 이후 전환·갱신에도 같은
   * 제약이 걸린다.
   */
  @Transactional
  public TokenResponse selectTenant(Long userId, Long tenantId, String authMethod) {
    if (!membershipRepository.hasActiveMembership(userId, tenantId)
        || !tenantRepository.isActive(tenantId)) {
      throw new TenantAccessDeniedException("해당 테넌트에 접근 권한이 없습니다.");
    }
    if (AuthDetails.SSO.equals(authMethod) && !tenantRepository.isSsoEnabled(tenantId)) {
      throw new TenantAccessDeniedException("이 워크스페이스는 SSO 로그인을 허용하지 않습니다.");
    }
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new InvalidTokenException("사용자를 찾을 수 없습니다."));
    // 토큰 amr 은 SSO 세션만 싣는다 — 비밀번호 세션(PASSWORD)은 기존처럼 amr 없는 토큰을 받는다.
    String amr = AuthDetails.SSO.equals(authMethod) ? AuthDetails.SSO : null;
    String accessToken =
        jwtTokenProvider.generateAccessToken(userId, user.username(), tenantId, amr);
    String refreshToken = jwtTokenProvider.generateRefreshToken(userId, tenantId, amr);
    storeRefreshToken(userId, refreshToken, UUID.randomUUID());
    // 여러 워크스페이스 소속은 고르거나 바꾸는 순간 그 워크스페이스에 「로그인」을 남긴다(WP-598) — 로그인 시점엔 어디로 들어갈지 몰랐다.
    logLogin(
        user,
        tenantId,
        "워크스페이스 선택으로 로그인",
        AuthDetails.SSO.equals(authMethod) ? Map.of("method", "sso") : null);
    return new TokenResponse(
        accessToken, refreshToken, "Bearer", jwtProperties.accessExpiration() / 1000);
  }

  /** 사용자의 선택 가능한 ACTIVE 멤버십 목록. WP-48: SSO 세션이면 SSO 켜진 워크스페이스만. */
  @Transactional(readOnly = true)
  public List<MembershipResponse> membershipsOf(Long userId, String authMethod) {
    return AuthDetails.SSO.equals(authMethod)
        ? membershipRepository.findActiveSsoEnabledByUser(userId)
        : membershipRepository.findActiveByUser(userId);
  }

  /** 재사용(탈취 의심)으로 family 를 폐기한 뒤 던지는 401 은 롤백하지 않는다(WP-819) — 폐기가 남아야 훔친 토큰으로 받은 새 토큰도 끊긴다. */
  @Transactional(noRollbackFor = RefreshTokenReuseException.class)
  public TokenResponse refresh(String rawRefreshToken) {
    if (!jwtTokenProvider.validateRefreshToken(rawRefreshToken)) {
      // 만료되었거나 유효하지 않은 리프레시 토큰 — 한국어 메시지 반환
      throw new InvalidTokenException("유효하지 않거나 만료된 토큰입니다.");
    }

    String tokenHash = hashToken(rawRefreshToken);

    var revocationInfo =
        refreshTokenRepository
            .findRevocationInfo(tokenHash)
            .orElseThrow(() -> new InvalidTokenException("만료되었거나 폐기된 토큰입니다. 다시 로그인해 주세요."));
    UUID familyId = revocationInfo.familyId();

    if (revocationInfo.revoked()) {
      // 이미 폐기된 토큰 재사용: 크로스탭 경쟁으로 인한 정상 재시도인지, 진짜 탈취인지 grace 조건으로 구분한다.
      // (1) 방금(grace period 이내) 폐기됐고 (2) family에 살아있는 형제 토큰이 있어야만 관용 — 둘 다 아니면 탈취로 간주.
      long graceSeconds = jwtProperties.refreshGracePeriodSeconds();
      boolean withinGrace =
          revocationInfo.revokedAt() != null
              && revocationInfo.revokedAt().isAfter(LocalDateTime.now().minusSeconds(graceSeconds));
      boolean familyAlive = refreshTokenRepository.existsLiveTokenInFamily(familyId);

      if (!withinGrace || !familyAlive) {
        refreshTokenRepository.revokeByFamilyId(familyId);
        // 이미 사용된 토큰 재사용 시도 — 보안 이슈, 한국어 메시지 반환
        throw new RefreshTokenReuseException();
      }
      // grace 적용: 이 토큰(tokenHash)은 이미 폐기 상태이므로 다시 revoke하지 않고, 같은 family로 새 토큰만 추가 발급한다.
    } else {
      if (!refreshTokenRepository.existsValidToken(tokenHash)) {
        // 만료된 토큰으로 갱신 시도 — 한국어 메시지 반환
        throw new InvalidTokenException("만료되었거나 폐기된 토큰입니다. 다시 로그인해 주세요.");
      }
      refreshTokenRepository.revokeByTokenHash(tokenHash);
    }

    Long userId = jwtTokenProvider.getUserIdFromToken(rawRefreshToken);
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new InvalidTokenException("토큰에 해당하는 사용자를 찾을 수 없습니다. 다시 로그인해 주세요."));

    if (!user.isActive()) {
      // 비활성화된 계정으로 토큰 갱신 시도 — 한국어 메시지 반환
      throw new UserDeactivatedException("비활성화된 계정입니다.");
    }

    // refresh 토큰에 active-tenant 가 있으면 동일 테넌트로 재발급하되, 이 세션이 그 테넌트를 여전히 쓸 수 있는지 재검증한다.
    // 더는 쓸 수 없으면(탈퇴·정지·삭제·영구 삭제 중, 또는 WP-48 SSO 세션인데 그 워크스페이스가 SSO 를 껐을 때) 로그아웃시키지 않고
    // 로그인과 같은 규칙으로 테넌트를 다시 고른다 — 새로 로그인한 것과 같은 권한이라 권한 상승이 아니다. 없으면 tenant-less 재발급.
    // 대체 후보는 SSO 세션이면 SSO 켜진 곳만이라(membershipsOf) 다시 고른 테넌트는 항상 이 세션의 인증 수단을 허용한다.
    Long tenantId = jwtTokenProvider.getTenantIdFromToken(rawRefreshToken);
    String amr = jwtTokenProvider.getAuthMethodFromToken(rawRefreshToken);
    if (tenantId != null && !isTenantUsable(userId, tenantId, amr)) {
      tenantId = reselectTenant(userId, amr);
    }

    String accessToken =
        jwtTokenProvider.generateAccessToken(user.id(), user.username(), tenantId, amr);
    String newRefreshToken = jwtTokenProvider.generateRefreshToken(user.id(), tenantId, amr);

    storeRefreshToken(user.id(), newRefreshToken, familyId);

    return new TokenResponse(
        accessToken, newRefreshToken, "Bearer", jwtProperties.accessExpiration() / 1000);
  }

  /**
   * 이 세션(인증 수단 amr)이 해당 테넌트를 계속 쓸 수 있는가 — 멤버십 ACTIVE({@code hasActiveMembership})·테넌트 ACTIVE({@code
   * isActive}), SSO 세션이면 SSO 도 켜져 있어야 한다({@code isSsoEnabled}). selectTenant 가 거절하는 경우(예외)와 같은 술어를
   * 불리언으로 판정하며, 통과하는 테넌트는 membershipsOf 목록에도 들어 있다.
   */
  private boolean isTenantUsable(Long userId, Long tenantId, String authMethod) {
    if (!membershipRepository.hasActiveMembership(userId, tenantId)
        || !tenantRepository.isActive(tenantId)) {
      return false;
    }
    return !AuthDetails.SSO.equals(authMethod) || tenantRepository.isSsoEnabled(tenantId);
  }

  /**
   * refresh 토큰의 테넌트를 더는 쓸 수 없을 때 대체 테넌트를 고른다 — 로그인(1단계)·SSO 세션 발급과 같은 규칙: 선택 가능한 멤버십(테넌트 ACTIVE 만,
   * SSO 세션이면 SSO 켜진 곳만)이 정확히 1개면 그 테넌트, 0개·여러 개면 null(tenant-less → 웹이 선택 화면/안내로 보낸다). 같은 조회({@link
   * #membershipsOf})를 써서 로그인 목록과 판정이 어긋나지 않게 한다.
   */
  private Long reselectTenant(Long userId, String authMethod) {
    List<MembershipResponse> remaining = membershipsOf(userId, authMethod);
    return remaining.size() == 1 ? remaining.get(0).tenantId() : null;
  }

  /**
   * WP-48: SSO 인증을 마친 사용자에게 세션을 발급한다. SSO 켜진 워크스페이스가 정확히 1개면 자동 선택(tenant-scoped), 여러 개면
   * tenant-less 로 발급해 웹이 선택 화면을 띄운다. access 토큰은 발급하지 않는다 — 웹이 /auth/refresh 로 받는다.
   *
   * @param memberships 진입 검사(SsoUserResolver)가 이미 조회한 SSO 켜진 ACTIVE 멤버십 — 재조회를 피한다.
   */
  @Transactional
  public SsoSession issueSsoSession(UserResponse user, List<MembershipResponse> memberships) {
    Long tenantId = memberships.size() == 1 ? memberships.get(0).tenantId() : null;
    String refreshToken =
        jwtTokenProvider.generateRefreshToken(user.id(), tenantId, AuthDetails.SSO);
    storeRefreshToken(user.id(), refreshToken, UUID.randomUUID());
    logLogin(user, tenantId, "SSO 로그인 성공", Map.of("method", "sso"));
    return new SsoSession(refreshToken, tenantId);
  }

  /**
   * 비밀번호를 바꾼 뒤 세션 정리(WP-566). 이 사용자의 refresh 토큰을 모두 폐기해 다른 기기·브라우저 세션이 더는 연장되지 않게 한다 — 비밀번호가 새어 바꾼
   * 경우 침입자 세션을 끊기 위해서다. 바꾼 브라우저 세션에는 같은 테넌트·인증 수단으로 새 refresh 토큰을 발급해 돌려준다(새 family — 폐기된 옛 토큰의
   * grace 재발급이 이 토큰의 family 에 기대지 못하게). PAT·API 키·Internal 호출(authMethod null)은 이어 줄 세션이 없어 null.
   *
   * @param tenantId 바꾸는 요청의 active-tenant(없으면 null — tenant-less 토큰으로 이어진다)
   */
  @Transactional
  public String revokeSessionsAfterPasswordChange(Long userId, Long tenantId, String authMethod) {
    refreshTokenRepository.revokeAllByUserId(userId);
    if (authMethod == null) {
      return null;
    }
    // 토큰 amr 은 SSO 세션만 싣는다(selectTenant 와 같은 규칙).
    String amr = AuthDetails.SSO.equals(authMethod) ? AuthDetails.SSO : null;
    String refreshToken = jwtTokenProvider.generateRefreshToken(userId, tenantId, amr);
    storeRefreshToken(userId, refreshToken, UUID.randomUUID());
    return refreshToken;
  }

  /**
   * 로그아웃 — 이 기기 세션만 끊는다(WP-627). 요청에 실려 온 refresh 토큰의 family(같은 로그인에서 회전된 토큰들)를 폐기하고, 다른 기기·브라우저
   * 로그인은 그대로 둔다. 모든 기기 끊기는 비밀번호 변경이 맡는다(WP-566). 토큰이 없거나 이 사용자 것이 아니면 아무 세션도 끊지 않는다(남의 세션을 끊는 통로가
   * 되지 않게).
   *
   * @param rawRefreshToken 이 기기의 refresh 쿠키 값(없으면 null)
   */
  @Transactional
  public void logout(Long userId, String rawRefreshToken) {
    if (rawRefreshToken != null && !rawRefreshToken.isBlank()) {
      refreshTokenRepository
          .findFamilyIdByTokenHashAndUser(hashToken(rawRefreshToken), userId)
          .ifPresent(refreshTokenRepository::revokeByFamilyId);
    }
    // 로그아웃 감사 로그 (#60/#92)
    userRepository
        .findById(userId)
        .ifPresent(
            user -> {
              // 토큰에 워크스페이스가 있으면 그 워크스페이스에 남긴다(WP-598) — 로그인 기록과 같은 곳.
              logAuth(user, TenantContext.get(), "LOGOUT", "로그아웃", null);
            });
  }

  /** 로그인 감사 — {@link #logAuth} 의 LOGIN. */
  private void logLogin(UserResponse user, Long tenantId, String description, Object metadata) {
    logAuth(user, tenantId, "LOGIN", description, metadata);
  }

  /**
   * 인증 감사를 남긴다(#60/#92). 들어간 워크스페이스(tenantId)가 있으면 그 워크스페이스의 감사로 남겨 그 관리자 화면에 보이게 하고(WP-598), 아직
   * 고르기 전(null)이면 지금처럼 워크스페이스 없는 행(운영자 열람)으로 남긴다.
   */
  private void logAuth(
      UserResponse user, Long tenantId, String action, String description, Object metadata) {
    auditLogService.logInTenantOrGlobal(
        tenantId,
        user.id(),
        user.username(),
        action,
        "auth",
        description,
        RequestInfo.current(),
        "SUCCESS",
        null,
        metadata);
  }

  @Transactional(readOnly = true)
  public UserResponse getCurrentUser(Long userId) {
    return userRepository
        .findById(userId)
        .orElseThrow(() -> new InvalidTokenException("토큰의 사용자를 찾을 수 없습니다. 다시 로그인해 주세요"));
  }

  private void storeRefreshToken(Long userId, String refreshToken, UUID familyId) {
    String tokenHash = hashToken(refreshToken);
    LocalDateTime expiresAt =
        LocalDateTime.now().plusSeconds(jwtProperties.refreshExpiration() / 1000);
    refreshTokenRepository.save(userId, tokenHash, expiresAt, familyId);
  }

  private String hashToken(String token) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      byte[] hash = digest.digest(token.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new CryptoException("SHA-256 not available", e);
    }
  }
}
