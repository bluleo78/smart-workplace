package com.workplace.platform.controller;

import com.workplace.global.security.JwtProperties;
import com.workplace.platform.dto.PlatformLoginRequest;
import com.workplace.platform.dto.PlatformTokenResponse;
import com.workplace.platform.dto.PlatformUserResponse;
import com.workplace.platform.service.PlatformAuthService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 운영자(플랫폼) 전용 인증 엔드포인트.
 *
 * <p>{@link com.workplace.auth.controller.AuthController} 를 미러하되 일반 평면과 분리한다: refresh 쿠키명은 {@code
 * platformRefreshToken}, path 는 {@code /api/platform/auth}. login/refresh 는 SecurityConfig 에서
 * permitAll, me/logout 은 플랫폼 토큰(ROLE_PLATFORM) 이 필요하다.
 */
@RestController
@RequestMapping("/api/platform/auth")
public class PlatformAuthController {

  private static final String REFRESH_TOKEN_COOKIE = "platformRefreshToken";
  private static final String REFRESH_TOKEN_PATH = "/api/platform/auth";

  private final PlatformAuthService platformAuthService;
  private final JwtProperties jwtProperties;
  private final boolean cookieSecure;

  public PlatformAuthController(
      PlatformAuthService platformAuthService,
      JwtProperties jwtProperties,
      @Value("${app.cookie.secure:true}") boolean cookieSecure) {
    this.platformAuthService = platformAuthService;
    this.jwtProperties = jwtProperties;
    this.cookieSecure = cookieSecure;
  }

  /** 운영자 로그인 — access 는 바디, refresh 는 HttpOnly 쿠키로 분리 전달. */
  @PostMapping("/login")
  public ResponseEntity<PlatformTokenResponse> login(
      @Valid @RequestBody PlatformLoginRequest request, HttpServletResponse response) {
    PlatformAuthService.PlatformLoginResult result = platformAuthService.login(request);
    addRefreshTokenCookie(response, result.refreshToken());
    return ResponseEntity.ok(
        new PlatformTokenResponse(result.accessToken(), "Bearer", result.expiresIn()));
  }

  /** 운영자 토큰 갱신 — 쿠키의 platform refresh 토큰으로 새 토큰 발급. 쿠키 없으면 401. */
  @PostMapping("/refresh")
  public ResponseEntity<PlatformTokenResponse> refresh(
      @CookieValue(name = REFRESH_TOKEN_COOKIE, required = false) String refreshToken,
      HttpServletResponse response) {
    if (refreshToken == null || refreshToken.isBlank()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
    PlatformAuthService.PlatformLoginResult result = platformAuthService.refresh(refreshToken);
    addRefreshTokenCookie(response, result.refreshToken());
    return ResponseEntity.ok(
        new PlatformTokenResponse(result.accessToken(), "Bearer", result.expiresIn()));
  }

  /** 운영자 로그아웃 — refresh 토큰 폐기 + 쿠키 만료. */
  @PostMapping("/logout")
  public ResponseEntity<Void> logout(Authentication authentication, HttpServletResponse response) {
    Long userId = (Long) authentication.getPrincipal();
    platformAuthService.logout(userId);
    clearRefreshTokenCookie(response);
    return ResponseEntity.noContent().build();
  }

  /** 운영자 본인 정보 조회. */
  @GetMapping("/me")
  public ResponseEntity<PlatformUserResponse> me(Authentication authentication) {
    Long userId = (Long) authentication.getPrincipal();
    return ResponseEntity.ok(platformAuthService.getCurrentUser(userId));
  }

  private void addRefreshTokenCookie(HttpServletResponse response, @NonNull String refreshToken) {
    ResponseCookie cookie =
        ResponseCookie.from(REFRESH_TOKEN_COOKIE, refreshToken)
            .httpOnly(true)
            .secure(cookieSecure)
            .sameSite("Lax")
            .path(REFRESH_TOKEN_PATH)
            .maxAge(jwtProperties.refreshExpiration() / 1000)
            .build();
    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
  }

  private void clearRefreshTokenCookie(HttpServletResponse response) {
    ResponseCookie cookie =
        ResponseCookie.from(REFRESH_TOKEN_COOKIE, "")
            .httpOnly(true)
            .secure(cookieSecure)
            .sameSite("Lax")
            .path(REFRESH_TOKEN_PATH)
            .maxAge(0)
            .build();
    response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
  }
}
