package com.workplace.auth.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.auth.dto.LoginRequest;
import com.workplace.auth.dto.SignupRequest;
import com.workplace.auth.dto.TokenResponse;
import com.workplace.auth.exception.AccountLockedException;
import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.auth.service.AuthService;
import com.workplace.global.config.SecurityConfig;
import com.workplace.global.security.ApiKeyAuthenticationFilter;
import com.workplace.global.security.JwtAuthenticationFilter;
import com.workplace.global.security.JwtProperties;
import com.workplace.global.security.JwtTokenProvider;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserResponse;
import com.workplace.user.repository.UserRepository;
import jakarta.servlet.http.Cookie;
import java.time.LocalDateTime;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@SuppressWarnings("null")
@WebMvcTest(AuthController.class)
@Import({SecurityConfig.class, JwtAuthenticationFilter.class, ApiKeyAuthenticationFilter.class})
class AuthControllerTest {

  @Autowired private MockMvc mockMvc;

  @Autowired private ObjectMapper objectMapper;

  @MockitoBean private AuthService authService;

  @MockitoBean private JwtTokenProvider jwtTokenProvider;

  @MockitoBean private JwtProperties jwtProperties;

  @MockitoBean private PermissionService permissionService;

  @MockitoBean private MembershipRepository membershipRepository;

  @MockitoBean private AgentApiKeyRepository agentApiKeyRepository;

  @MockitoBean private UserRepository userRepository;

  @Test
  void signup_returnsCreated() throws Exception {
    SignupRequest request =
        new SignupRequest("test@example.com", "test@example.com", "Password123", "Test User");
    UserResponse response =
        new UserResponse(
            1L,
            "test@example.com",
            "test@example.com",
            "Test User",
            true,
            LocalDateTime.now(),
            "HUMAN");

    // 가입 게이트는 가용성 술어를 먼저 읽는다 — 부트스트랩 가능 상태로 둔다.
    when(authService.isSignupAvailable()).thenReturn(true);
    when(authService.signup(any(SignupRequest.class))).thenReturn(response);

    mockMvc
        .perform(
            post("/api/v1/auth/signup")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isCreated())
        .andExpect(jsonPath("$.username").value("test@example.com"))
        .andExpect(jsonPath("$.name").value("Test User"));
  }

  /** 부트스트랩(첫 사용자) 이후 공개 가입은 막힌다 — 가용성 false → 403, signup 미호출. */
  @Test
  void signup_whenDisabled_returnsForbidden() throws Exception {
    SignupRequest request =
        new SignupRequest("blocked@example.com", "blocked@example.com", "Password123", "Blocked");

    when(authService.isSignupAvailable()).thenReturn(false);

    mockMvc
        .perform(
            post("/api/v1/auth/signup")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isForbidden());

    verify(authService, org.mockito.Mockito.never()).signup(any(SignupRequest.class));
  }

  /** 가용성 조회 — 게이트와 동일한 술어를 그대로 노출한다. */
  @Test
  void signupAvailable_reflectsPredicate() throws Exception {
    when(authService.isSignupAvailable()).thenReturn(true);
    mockMvc
        .perform(get("/api/v1/auth/signup-available"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.available").value(true));

    when(authService.isSignupAvailable()).thenReturn(false);
    mockMvc
        .perform(get("/api/v1/auth/signup-available"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.available").value(false));
  }

  @Test
  void signup_invalidEmail_returnsBadRequest() throws Exception {
    SignupRequest request = new SignupRequest("not-email", "not-email", "Password123", "Test User");

    mockMvc
        .perform(
            post("/api/v1/auth/signup")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isBadRequest());
  }

  @Test
  void login_returnsOkWithCookie() throws Exception {
    LoginRequest request = new LoginRequest("test@example.com", "Password123");
    AuthService.LoginResult loginResult =
        new AuthService.LoginResult("access-token", "refresh-token", 1800, java.util.List.of());

    when(authService.login(any(LoginRequest.class))).thenReturn(loginResult);
    when(jwtProperties.refreshExpiration()).thenReturn(604800000L);

    mockMvc
        .perform(
            post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accessToken").value("access-token"))
        .andExpect(jsonPath("$.refreshToken").doesNotExist())
        .andExpect(jsonPath("$.tokenType").value("Bearer"))
        .andExpect(header().exists("Set-Cookie"));
  }

  @Test
  void refresh_withCookie_returnsOk() throws Exception {
    TokenResponse tokenResponse = new TokenResponse("new-access", "new-refresh", "Bearer", 1800);

    when(authService.refresh(eq("some-refresh-token"))).thenReturn(tokenResponse);
    when(jwtProperties.refreshExpiration()).thenReturn(604800000L);

    mockMvc
        .perform(
            post("/api/v1/auth/refresh").cookie(new Cookie("refreshToken", "some-refresh-token")))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.accessToken").value("new-access"))
        .andExpect(header().exists("Set-Cookie"));
  }

  @Test
  void refresh_withoutCookie_returnsUnauthorized() throws Exception {
    mockMvc.perform(post("/api/v1/auth/refresh")).andExpect(status().isUnauthorized());
  }

  @Test
  void login_accountLocked_returns429() throws Exception {
    LoginRequest request = new LoginRequest("locked@example.com", "Password123");

    when(authService.login(any(LoginRequest.class)))
        .thenThrow(
            new AccountLockedException("Too many failed login attempts. Please try again later."));

    mockMvc
        .perform(
            post("/api/v1/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(request)))
        .andExpect(status().isTooManyRequests())
        .andExpect(jsonPath("$.status").value(429))
        .andExpect(jsonPath("$.error").value("Too Many Requests"));
  }

  @Test
  void logout_returnsNoContent() throws Exception {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(1L);

    mockMvc
        .perform(post("/api/v1/auth/logout").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isNoContent())
        .andExpect(header().exists("Set-Cookie"));

    verify(authService).logout(1L);
  }

  /**
   * /me/permissions 는 세션 사용자의 권한 코드 목록을 반환한다. ai-agent 가 MCP 파괴 도구 필터링에 사용하는 경로이므로 JWT/Internal 인증
   * 어느 쪽에서도 동작해야 한다. 여기서는 JWT 경로를 검증한다.
   */
  @Test
  void getMyPermissions_returnsCodes() throws Exception {
    when(jwtTokenProvider.validateAccessToken("valid-token")).thenReturn(true);
    when(jwtTokenProvider.getUserIdFromToken("valid-token")).thenReturn(42L);
    when(permissionService.getUserPermissions(42L))
        .thenReturn(Set.of("dataset:read", "dataset:delete"));

    mockMvc
        .perform(get("/api/v1/auth/me/permissions").header("Authorization", "Bearer valid-token"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$").isArray())
        .andExpect(jsonPath("$.length()").value(2));
  }
}
