package com.workplace.auth.controller;

import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.dto.LoginResponse;
import com.workplace.auth.dto.SelectTenantRequest;
import com.workplace.auth.dto.SignupAvailableResponse;
import com.workplace.auth.dto.SignupRequest;
import com.workplace.auth.dto.TokenResponse;
import com.workplace.auth.exception.SignupDisabledException;
import com.workplace.auth.service.AuthService;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.dto.MembershipResponse;
import com.workplace.user.dto.UserResponse;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Set;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.NonNull;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

  private static final String REFRESH_TOKEN_COOKIE = "refreshToken";
  private static final String REFRESH_TOKEN_PATH = "/api/v1/auth";

  private final AuthService authService;
  private final JwtProperties jwtProperties;
  private final PermissionService permissionService;
  private final boolean cookieSecure;

  public AuthController(
      AuthService authService,
      JwtProperties jwtProperties,
      PermissionService permissionService,
      @org.springframework.beans.factory.annotation.Value("${app.cookie.secure:true}")
          boolean cookieSecure) {
    this.authService = authService;
    this.cookieSecure = cookieSecure;
    this.jwtProperties = jwtProperties;
    this.permissionService = permissionService;
  }

  /**
   * 공개 셀프 회원가입 가용성 — 부트스트랩(첫 사용자) 전에는 true, 이후 false.
   *
   * <p>웹 가입 화면이 폼 노출 여부를 판단한다. 가입 차단 집행({@link #signup})과 동일한 술어({@code
   * AuthService.isSignupAvailable})를 읽어 표시·집행이 어긋나지 않게 한다.
   */
  @GetMapping("/signup-available")
  public ResponseEntity<SignupAvailableResponse> signupAvailable() {
    return ResponseEntity.ok(new SignupAvailableResponse(authService.isSignupAvailable()));
  }

  @PostMapping("/signup")
  public ResponseEntity<UserResponse> signup(@Valid @RequestBody SignupRequest request) {
    // 공개 셀프 가입 게이트 — 부트스트랩(첫 사용자) 이후에는 웹 가입을 막는다(403). 신규 사용자는 운영자 콘솔에서
    // 테넌트 멤버로 추가하며 계정이 생성된다(#495/#497). authService.signup 자체는 멤버 추가 등 내부 경로의
    // 재사용 가능한 프리미티브로 남기고, "공개 가입 가능 여부" 정책은 이 HTTP 경계에서만 집행한다.
    if (!authService.isSignupAvailable()) {
      throw new SignupDisabledException("회원가입이 비활성화되어 있습니다. 관리자에게 문의하세요.");
    }
    // signup 은 과도기 모델에서 tenant#1 컨텍스트로 처리한다(전역 시스템 role 조회/할당이 RLS 하에서
    // 동작하도록). @Transactional 인 AuthService.signup 안에서 설정하면 TenantAwareTransactionManager
    // 가 tx-start(doBegin) 시점에 TenantContext 를 읽으므로 이미 늦다 → 비-트랜잭션 컨트롤러 경계에서 설정.
    // 멀티테넌트 셀프-가입/초대 흐름은 후속(P3/§8).
    TenantContext.set(1L);
    try {
      UserResponse user = authService.signup(request);
      return ResponseEntity.status(HttpStatus.CREATED).body(user);
    } finally {
      TenantContext.clear();
    }
  }

  @PostMapping("/login")
  public ResponseEntity<LoginResponse> login(
      @Valid @RequestBody LoginRequest request, HttpServletResponse response) {
    // 1단계: 신원 인증 → tenant-less access(바디) + refresh(쿠키) + 선택 가능한 멤버십(바디)
    AuthService.LoginResult result = authService.login(request);
    addRefreshTokenCookie(response, result.refreshToken());
    return ResponseEntity.ok(
        new LoginResponse(
            result.accessToken(), "Bearer", result.expiresIn(), result.memberships()));
  }

  @PostMapping("/select-tenant")
  public ResponseEntity<TokenResponse> selectTenant(
      Authentication authentication,
      @Valid @RequestBody SelectTenantRequest request,
      HttpServletResponse response) {
    // 2단계: tenant-less(또는 기존) access 토큰으로 인증된 사용자가 활성 테넌트를 선택/전환
    Long userId = (Long) authentication.getPrincipal();
    TokenResponse token = authService.selectTenant(userId, request.tenantId());
    addRefreshTokenCookie(response, token.refreshToken());
    TokenResponse body =
        new TokenResponse(token.accessToken(), null, token.tokenType(), token.expiresIn());
    return ResponseEntity.ok(body);
  }

  @GetMapping("/memberships")
  public ResponseEntity<List<MembershipResponse>> memberships(Authentication authentication) {
    Long userId = (Long) authentication.getPrincipal();
    return ResponseEntity.ok(authService.membershipsOf(userId));
  }

  @PostMapping("/refresh")
  public ResponseEntity<TokenResponse> refresh(
      @CookieValue(name = REFRESH_TOKEN_COOKIE, required = false) String refreshToken,
      HttpServletResponse response) {
    if (refreshToken == null || refreshToken.isBlank()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
    TokenResponse token = authService.refresh(refreshToken);
    addRefreshTokenCookie(response, token.refreshToken());
    TokenResponse body =
        new TokenResponse(token.accessToken(), null, token.tokenType(), token.expiresIn());
    return ResponseEntity.ok(body);
  }

  @PostMapping("/logout")
  public ResponseEntity<Void> logout(Authentication authentication, HttpServletResponse response) {
    Long userId = (Long) authentication.getPrincipal();
    authService.logout(userId);
    clearRefreshTokenCookie(response);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/me")
  public ResponseEntity<UserResponse> me(Authentication authentication) {
    Long userId = (Long) authentication.getPrincipal();
    UserResponse user = authService.getCurrentUser(userId);
    return ResponseEntity.ok(user);
  }

  /**
   * 현재 세션 사용자에게 부여된 권한 코드 목록을 반환한다.
   *
   * <p>ai-agent 가 MCP 파괴적 도구(delete_dataset 등)를 사용자 권한 기준으로 필터링(fail-closed)하기 위해 사용한다. 내부 서비스 통신
   * 경로에서도 `Authorization: Internal <token>` + `X-On-Behalf-Of: userId` 헤더로 호출되며,
   * JwtAuthenticationFilter 가 해당 헤더를 처리하여 Authentication 에 userId 를 주입한다.
   */
  @GetMapping("/me/permissions")
  public ResponseEntity<List<String>> getMyPermissions(Authentication authentication) {
    Long userId = (Long) authentication.getPrincipal();
    Set<String> codes = permissionService.getUserPermissions(userId);
    return ResponseEntity.ok(List.copyOf(codes));
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
