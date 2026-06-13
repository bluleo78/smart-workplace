package com.workplace.auth.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.dto.SignupRequest;
import com.workplace.auth.dto.TokenResponse;
import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.exception.AgentCannotLoginException;
import com.workplace.auth.exception.EmailAlreadyExistsException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.exception.TenantAccessDeniedException;
import com.workplace.auth.exception.UsernameAlreadyExistsException;
import com.workplace.auth.repository.RefreshTokenRepository;
import com.workplace.global.exception.CryptoException;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.role.exception.RoleNotFoundException;
import com.workplace.role.repository.RoleRepository;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.tenant.repository.TenantRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.exception.UserDeactivatedException;
import com.workplace.user.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

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
  private final AuditLogService auditLogService;
  private final MembershipRepository membershipRepository;
  private final TenantRepository tenantRepository;

  /** 1단계 로그인 결과(내부 운반용): accessToken/refreshToken 분리 + 선택 가능한 멤버십. */
  public record LoginResult(
      String accessToken,
      String refreshToken,
      long expiresIn,
      List<MembershipResponse> memberships) {}

  @Transactional
  public UserResponse signup(SignupRequest request) {
    if (userRepository.existsByUsername(request.username())) {
      // 사용자에게 한국어 메시지 반환 — 영문 원문 메시지 노출 방지
      throw new UsernameAlreadyExistsException("이미 사용 중인 아이디입니다.");
    }
    if (request.email() != null
        && !request.email().isBlank()
        && userRepository.existsByEmail(request.email())) {
      // 사용자에게 한국어 메시지 반환 — 영문 원문 메시지 노출 방지
      throw new EmailAlreadyExistsException("이미 사용 중인 이메일입니다.");
    }

    userRepository.acquireFirstUserLock();
    boolean isFirstUser = userRepository.countAll(null) == 0;

    String encodedPassword = passwordEncoder.encode(request.password());
    UserResponse user =
        userRepository.save(request.username(), request.email(), encodedPassword, request.name());

    // Assign roles: first user gets ADMIN + USER, subsequent users get USER only
    Long userRoleId =
        roleRepository
            .findByName("USER")
            .orElseThrow(() -> new RoleNotFoundException("System role not found: USER"))
            .id();
    userRepository.addRole(user.id(), userRoleId);

    if (isFirstUser) {
      Long adminRoleId =
          roleRepository
              .findByName("ADMIN")
              .orElseThrow(() -> new RoleNotFoundException("System role not found: ADMIN"))
              .id();
      userRepository.addRole(user.id(), adminRoleId);
    }

    return user;
  }

  @Transactional
  public LoginResult login(LoginRequest request) {
    if (loginAttemptService.isBlocked(request.username())) {
      // 과도한 로그인 실패로 계정이 잠긴 경우 한국어 메시지 반환
      throw new AccountLockedException("로그인 시도 횟수를 초과하였습니다. 잠시 후 다시 시도해 주세요.");
    }

    UserResponse user =
        userRepository
            .findByUsername(request.username())
            .orElseThrow(
                () -> {
                  loginAttemptService.loginFailed(request.username());
                  // 사용자 존재 여부 노출 방지를 위해 동일한 메시지 반환
                  return new InvalidCredentialsException("아이디 또는 비밀번호가 올바르지 않습니다.");
                });

    // Phase 5a — AGENT 는 비밀번호 로그인 흐름 사용 금지. login_attempts 카운터는 증가시키지 않는다.
    if (UserKind.isAgent(user.kind())) {
      throw new AgentCannotLoginException();
    }

    String storedPassword =
        userRepository
            .findPasswordByUsername(request.username())
            .orElseThrow(
                () -> {
                  loginAttemptService.loginFailed(request.username());
                  // 사용자 존재 여부 노출 방지를 위해 동일한 메시지 반환
                  return new InvalidCredentialsException("아이디 또는 비밀번호가 올바르지 않습니다.");
                });

    if (!passwordEncoder.matches(request.password(), storedPassword)) {
      loginAttemptService.loginFailed(request.username());
      throw new InvalidCredentialsException("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    if (!user.isActive()) {
      // 비활성화된 계정 접근 시 한국어 메시지 반환
      throw new UserDeactivatedException("비활성화된 계정입니다.");
    }

    loginAttemptService.loginSucceeded(request.username());

    // 1단계: 테넌트 미선택(tenant-less) 토큰 발급. 테넌트 스코프 데이터는 select-tenant 후에야 접근 가능.
    String accessToken = jwtTokenProvider.generateAccessToken(user.id(), user.username(), null);
    String refreshToken = jwtTokenProvider.generateRefreshToken(user.id(), null);

    UUID familyId = UUID.randomUUID();
    storeRefreshToken(user.id(), refreshToken, familyId);

    // 로그인 감사 로그 (#60/#92)
    String[] requestInfo = extractRequestInfo();
    auditLogService.log(
        user.id(),
        user.username(),
        "LOGIN",
        "auth",
        null,
        "로그인 성공",
        requestInfo[0],
        requestInfo[1],
        "SUCCESS",
        null,
        null);

    return new LoginResult(
        accessToken,
        refreshToken,
        jwtProperties.accessExpiration() / 1000,
        membershipRepository.findActiveByUser(user.id()));
  }

  /** 2단계: 테넌트 선택 → membership+tenant ACTIVE 검증 후 tenant 스코프 토큰 발급. 전환도 이 메서드. */
  @Transactional
  public TokenResponse selectTenant(Long userId, Long tenantId) {
    if (!membershipRepository.hasActiveMembership(userId, tenantId)
        || !tenantRepository.isActive(tenantId)) {
      throw new TenantAccessDeniedException("해당 테넌트에 접근 권한이 없습니다.");
    }
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new InvalidTokenException("사용자를 찾을 수 없습니다."));
    String accessToken = jwtTokenProvider.generateAccessToken(userId, user.username(), tenantId);
    String refreshToken = jwtTokenProvider.generateRefreshToken(userId, tenantId);
    storeRefreshToken(userId, refreshToken, UUID.randomUUID());
    return new TokenResponse(
        accessToken, refreshToken, "Bearer", jwtProperties.accessExpiration() / 1000);
  }

  /** 사용자의 선택 가능한 ACTIVE 멤버십 목록. */
  @Transactional(readOnly = true)
  public List<MembershipResponse> membershipsOf(Long userId) {
    return membershipRepository.findActiveByUser(userId);
  }

  @Transactional
  public TokenResponse refresh(String rawRefreshToken) {
    if (!jwtTokenProvider.validateRefreshToken(rawRefreshToken)) {
      // 만료되었거나 유효하지 않은 리프레시 토큰 — 한국어 메시지 반환
      throw new InvalidTokenException("유효하지 않거나 만료된 토큰입니다.");
    }

    String tokenHash = hashToken(rawRefreshToken);

    // Token reuse detection: if the token was already revoked, an attacker may have
    // stolen a previously used token. Revoke the entire token family for safety.
    if (refreshTokenRepository.isTokenRevoked(tokenHash)) {
      refreshTokenRepository
          .findFamilyIdByTokenHash(tokenHash)
          .ifPresent(refreshTokenRepository::revokeByFamilyId);
      // 이미 사용된 토큰 재사용 시도 — 보안 이슈, 한국어 메시지 반환
      throw new InvalidTokenException("이미 사용된 토큰입니다. 다시 로그인해 주세요.");
    }

    if (!refreshTokenRepository.existsValidToken(tokenHash)) {
      // 폐기된 토큰으로 갱신 시도 — 한국어 메시지 반환
      throw new InvalidTokenException("만료되었거나 폐기된 토큰입니다. 다시 로그인해 주세요.");
    }

    // Look up the family before revoking the current token
    UUID familyId =
        refreshTokenRepository
            .findFamilyIdByTokenHash(tokenHash)
            .orElseThrow(() -> new InvalidTokenException("토큰 정보를 찾을 수 없습니다. 다시 로그인해 주세요."));

    refreshTokenRepository.revokeByTokenHash(tokenHash);

    Long userId = jwtTokenProvider.getUserIdFromToken(rawRefreshToken);
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new InvalidTokenException("토큰에 해당하는 사용자를 찾을 수 없습니다. 다시 로그인해 주세요."));

    if (!user.isActive()) {
      // 비활성화된 계정으로 토큰 갱신 시도 — 한국어 메시지 반환
      throw new UserDeactivatedException("비활성화된 계정입니다.");
    }

    // refresh 토큰에 active-tenant 가 있으면 동일 테넌트로 재발급하되, 멤버십/테넌트가 여전히 ACTIVE
    // 인지 재검증한다(정지/탈퇴 시 즉시 차단 → 클라이언트는 테넌트 선택으로 복귀). 없으면 tenant-less 재발급.
    Long tenantId = jwtTokenProvider.getTenantIdFromToken(rawRefreshToken);
    if (tenantId != null
        && (!membershipRepository.hasActiveMembership(userId, tenantId)
            || !tenantRepository.isActive(tenantId))) {
      throw new InvalidTokenException("테넌트 접근이 만료되었습니다. 테넌트를 다시 선택해 주세요.");
    }

    String accessToken = jwtTokenProvider.generateAccessToken(user.id(), user.username(), tenantId);
    String newRefreshToken = jwtTokenProvider.generateRefreshToken(user.id(), tenantId);

    storeRefreshToken(user.id(), newRefreshToken, familyId);

    return new TokenResponse(
        accessToken, newRefreshToken, "Bearer", jwtProperties.accessExpiration() / 1000);
  }

  @Transactional
  public void logout(Long userId) {
    refreshTokenRepository.revokeAllByUserId(userId);
    // 로그아웃 감사 로그 (#60/#92)
    userRepository
        .findById(userId)
        .ifPresent(
            user -> {
              String[] requestInfo = extractRequestInfo();
              auditLogService.log(
                  userId,
                  user.username(),
                  "LOGOUT",
                  "auth",
                  null,
                  "로그아웃",
                  requestInfo[0],
                  requestInfo[1],
                  "SUCCESS",
                  null,
                  null);
            });
  }

  @Transactional(readOnly = true)
  public UserResponse getCurrentUser(Long userId) {
    return userRepository
        .findById(userId)
        .orElseThrow(() -> new InvalidTokenException("User not found"));
  }

  private void storeRefreshToken(Long userId, String refreshToken, UUID familyId) {
    String tokenHash = hashToken(refreshToken);
    LocalDateTime expiresAt =
        LocalDateTime.now().plusSeconds(jwtProperties.refreshExpiration() / 1000);
    refreshTokenRepository.save(userId, tokenHash, expiresAt, familyId);
  }

  /** HTTP 요청 컨텍스트에서 IP와 User-Agent를 추출한다. 감사 로그에 사용 */
  private String[] extractRequestInfo() {
    var attrs = RequestContextHolder.getRequestAttributes();
    if (attrs instanceof ServletRequestAttributes sra) {
      HttpServletRequest req = sra.getRequest();
      String forwarded = req.getHeader("X-Forwarded-For");
      String ip =
          (forwarded != null && !forwarded.isBlank())
              ? forwarded.split(",")[0].trim()
              : req.getRemoteAddr();
      return new String[] {ip, req.getHeader("User-Agent")};
    }
    return new String[] {null, null};
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
