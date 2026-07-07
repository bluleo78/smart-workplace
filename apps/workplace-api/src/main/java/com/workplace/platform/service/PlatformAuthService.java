package com.workplace.platform.service;

import com.workplace.audit.service.AuditLogService;
import com.workplace.auth.exception.AgentCannotLoginException;
import com.workplace.auth.exception.InvalidCredentialsException;
import com.workplace.auth.exception.InvalidTokenException;
import com.workplace.auth.repository.RefreshTokenRepository;
import com.workplace.auth.service.LoginAttemptService;
import com.workplace.global.exception.CryptoException;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.platform.dto.PlatformLoginRequest;
import com.workplace.platform.dto.PlatformUserResponse;
import com.workplace.platform.exception.PlatformAccessDeniedException;
import com.workplace.platform.repository.PlatformRoleRepository;
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
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

/**
 * 운영자(플랫폼) 전용 인증 서비스.
 *
 * <p>{@link com.workplace.auth.service.AuthService} 의 login/refresh 흐름(브루트포스 카운터·AGENT 차단·isActive
 * 검사·감사 로그·refresh reuse-detection/family)을 충실히 미러하되, 멀티테넌트 평면과 분리한다:
 *
 * <ul>
 *   <li>비밀번호 검증 통과 후 플랫폼 역할 보유({@code platform_user_role}) 를 확인해 운영자 권한 없는 사용자의 권한상승을 차단한다.
 *   <li>토큰은 tenant 없는 platform 토큰({@code platform=true})으로 발급한다.
 *   <li>refresh 진입 시 platform 토큰 여부를 가장 먼저 확인해 일반(테넌트) refresh 토큰의 평면 교차를 차단한다.
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class PlatformAuthService {

  private final UserRepository userRepository;
  private final PlatformRoleRepository platformRoleRepository;
  private final PasswordEncoder passwordEncoder;
  private final JwtTokenProvider jwtTokenProvider;
  private final JwtProperties jwtProperties;
  private final RefreshTokenRepository refreshTokenRepository;
  private final LoginAttemptService loginAttemptService;
  private final AuditLogService auditLogService;

  /** 운영자 로그인/리프레시 결과(내부 운반용): accessToken/refreshToken 분리 + 만료(초) + 사용자. */
  public record PlatformLoginResult(
      String accessToken, String refreshToken, long expiresIn, UserResponse user) {}

  /** 운영자 로그인 — 자격 검증 + 플랫폼 역할 보유 확인 후 platform 토큰 발급. */
  @Transactional
  public PlatformLoginResult login(PlatformLoginRequest request) {
    // 일반 로그인과 동일한 브루트포스 잠금 정책을 적용한다.
    if (loginAttemptService.isBlocked(request.username())) {
      throw new com.workplace.auth.exception.AccountLockedException(
          "로그인 시도 횟수를 초과하였습니다. 잠시 후 다시 시도해 주세요.");
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

    // AGENT 는 비밀번호 로그인 흐름 사용 금지. login_attempts 카운터는 증가시키지 않는다.
    if (UserKind.isAgent(user.kind())) {
      throw new AgentCannotLoginException();
    }

    String storedPassword =
        userRepository
            .findPasswordByUsername(request.username())
            .orElseThrow(
                () -> {
                  loginAttemptService.loginFailed(request.username());
                  return new InvalidCredentialsException("아이디 또는 비밀번호가 올바르지 않습니다.");
                });

    if (!passwordEncoder.matches(request.password(), storedPassword)) {
      loginAttemptService.loginFailed(request.username());
      throw new InvalidCredentialsException("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    if (!user.isActive()) {
      throw new UserDeactivatedException("비활성화된 계정입니다.");
    }

    // 자격이 유효해도 플랫폼 역할이 없으면 운영자 평면 접근 거부(권한상승 차단). 역할 기반(platform_user_role).
    if (!platformRoleRepository.hasAnyPlatformRole(user.id())) {
      throw new PlatformAccessDeniedException("운영자 권한이 없습니다.");
    }

    loginAttemptService.loginSucceeded(request.username());

    String accessToken = jwtTokenProvider.generatePlatformAccessToken(user.id(), user.username());
    String refreshToken = jwtTokenProvider.generatePlatformRefreshToken(user.id());

    UUID familyId = UUID.randomUUID();
    storeRefreshToken(user.id(), refreshToken, familyId);

    // 운영자 로그인 감사 로그
    String[] requestInfo = extractRequestInfo();
    auditLogService.log(
        user.id(),
        user.username(),
        "PLATFORM_LOGIN",
        "platform",
        null,
        "운영자 로그인 성공",
        requestInfo[0],
        requestInfo[1],
        "SUCCESS",
        null,
        null);

    return new PlatformLoginResult(
        accessToken, refreshToken, jwtProperties.accessExpiration() / 1000, user);
  }

  /** 운영자 토큰 갱신 — platform refresh 토큰만 허용(평면 교차 차단), reuse-detection/family 회전. */
  @Transactional
  public PlatformLoginResult refresh(String rawRefreshToken) {
    // 평면 교차 차단: 일반(테넌트) refresh 토큰으로 운영자 토큰을 발급받는 것을 가장 먼저 거부한다.
    if (!jwtTokenProvider.isPlatformToken(rawRefreshToken)) {
      throw new InvalidTokenException("유효하지 않은 운영자 토큰입니다. 다시 로그인해 주세요.");
    }

    if (!jwtTokenProvider.validateRefreshToken(rawRefreshToken)) {
      throw new InvalidTokenException("유효하지 않거나 만료된 토큰입니다.");
    }

    String tokenHash = hashToken(rawRefreshToken);

    var revocationInfo =
        refreshTokenRepository
            .findRevocationInfo(tokenHash)
            .orElseThrow(() -> new InvalidTokenException("만료되었거나 폐기된 토큰입니다. 다시 로그인해 주세요."));
    UUID familyId = revocationInfo.familyId();

    if (revocationInfo.revoked()) {
      // 크로스탭 경쟁 완화: AuthService.refresh() 와 동일한 grace 조건(#grace-period).
      long graceSeconds = jwtProperties.refreshGracePeriodSeconds();
      boolean withinGrace =
          revocationInfo.revokedAt() != null
              && revocationInfo.revokedAt().isAfter(LocalDateTime.now().minusSeconds(graceSeconds));
      boolean familyAlive = refreshTokenRepository.existsLiveTokenInFamily(familyId);

      if (!withinGrace || !familyAlive) {
        refreshTokenRepository.revokeByFamilyId(familyId);
        throw new InvalidTokenException("이미 사용된 토큰입니다. 다시 로그인해 주세요.");
      }
      // grace 적용 — 재revoke 없이 아래에서 같은 family로 새 토큰만 발급.
    } else {
      if (!refreshTokenRepository.existsValidToken(tokenHash)) {
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
      throw new UserDeactivatedException("비활성화된 계정입니다.");
    }

    // 토큰 회전 사이 운영자 권한이 회수되었을 수 있으므로 재검증한다(권한상승 차단 일관 유지).
    if (!platformRoleRepository.hasAnyPlatformRole(userId)) {
      throw new PlatformAccessDeniedException("운영자 권한이 없습니다.");
    }

    String accessToken = jwtTokenProvider.generatePlatformAccessToken(user.id(), user.username());
    String newRefreshToken = jwtTokenProvider.generatePlatformRefreshToken(user.id());

    storeRefreshToken(user.id(), newRefreshToken, familyId);

    return new PlatformLoginResult(
        accessToken, newRefreshToken, jwtProperties.accessExpiration() / 1000, user);
  }

  /** 운영자 로그아웃 — 해당 사용자의 모든 refresh 토큰 폐기 + 감사 로그. */
  @Transactional
  public void logout(Long userId) {
    refreshTokenRepository.revokeAllByUserId(userId);
    userRepository
        .findById(userId)
        .ifPresent(
            user -> {
              String[] requestInfo = extractRequestInfo();
              auditLogService.log(
                  userId,
                  user.username(),
                  "PLATFORM_LOGOUT",
                  "platform",
                  null,
                  "운영자 로그아웃",
                  requestInfo[0],
                  requestInfo[1],
                  "SUCCESS",
                  null,
                  null);
            });
  }

  /** 운영자 본인 정보 조회. */
  @Transactional(readOnly = true)
  public PlatformUserResponse getCurrentUser(Long userId) {
    UserResponse user =
        userRepository
            .findById(userId)
            .orElseThrow(() -> new InvalidTokenException("사용자를 찾을 수 없습니다."));
    return new PlatformUserResponse(
        user.id(),
        user.username(),
        user.name(),
        user.email(),
        platformRoleRepository.findPermissionCodes(userId));
  }

  private void storeRefreshToken(Long userId, String refreshToken, UUID familyId) {
    String tokenHash = hashToken(refreshToken);
    LocalDateTime expiresAt =
        LocalDateTime.now().plusSeconds(jwtProperties.refreshExpiration() / 1000);
    refreshTokenRepository.save(userId, tokenHash, expiresAt, familyId);
  }

  /** HTTP 요청 컨텍스트에서 IP와 User-Agent를 추출한다. 감사 로그에 사용. */
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
