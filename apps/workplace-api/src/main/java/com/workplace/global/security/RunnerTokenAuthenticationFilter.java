package com.workplace.global.security;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * runner 토큰({@code Bearer rt_...}) 인증 필터(WP-1249). runner 전용 경로({@link #PATH_PREFIX})에서만 동작한다 — 다른
 * 경로의 {@code rt_} 는 이 필터가 건너뛰고 JWT 필터도 해석하지 못해 401 이 된다. 검증은 {@link RunnerTokenAuthenticator}(실행 위치
 * 모듈 구현)에 맡긴다. 주체는 runner 주체(테넌트·위치)라 {@code Long userId} 를 기대하는 일반 컨트롤러에 닿으면 안 되므로, SecurityConfig
 * 가 runner 경로를 {@code ROLE_RUNNER} 로만 열고 다른 인증(사람 JWT·AI 키·개인 토큰)은 그 경로에서 403 을 받게 한다.
 *
 * <p>검증 실패·비활성 테넌트면 아무것도 쓰지 않고 넘긴다 — 인증이 없으니 진입점이 다른 401 과 같은 모양으로 답한다. 성공하면 토큰의 테넌트로 TenantContext
 * 를 세워 이후 트랜잭션이 RLS GUC 를 받게 하고, 요청이 끝나면 항상 지운다(풀링 스레드로 새지 않게).
 */
@Component
public class RunnerTokenAuthenticationFilter extends OncePerRequestFilter {

  /** runner 전용 API 경로 접두사 — SecurityConfig 의 경로 규칙과 같은 값을 쓴다. */
  public static final String PATH_PREFIX = "/api/v1/agent-runtime/runner/";

  /** runner 인증에 붙는 권한 — SecurityConfig 가 {@code hasRole("RUNNER")} 로 확인한다. */
  public static final String ROLE = "ROLE_RUNNER";

  /** runner 토큰 접두사 — Bearer scheme 뒤 토큰이 이것으로 시작할 때만 이 필터가 맡는다. */
  private static final String RT_PREFIX = "rt_";

  private final RunnerTokenAuthenticator authenticator;
  // 정지·삭제된 워크스페이스의 토큰은 인증하지 않는다 — 다른 인증 필터와 같은 기준(WP-341).
  private final TenantStatusChecker tenantStatusChecker;

  public RunnerTokenAuthenticationFilter(
      RunnerTokenAuthenticator authenticator, TenantStatusChecker tenantStatusChecker) {
    this.authenticator = authenticator;
    this.tenantStatusChecker = tenantStatusChecker;
  }

  /**
   * runner 경로가 아니거나 헤더가 {@code Bearer rt_} 가 아니면 건너뛴다. scheme 은 대소문자 무관(RFC 7235, WP-1431)이라 {@code
   * bearer rt_…} 도 맡는다.
   */
  @Override
  protected boolean shouldNotFilter(@NonNull HttpServletRequest request) {
    // 경로를 먼저 본다 — runner 경로가 아니면 헤더를 읽지도 않는다(다른 요청마다 헤더 파싱을 하지 않게).
    String path = request.getRequestURI().substring(request.getContextPath().length());
    if (!path.startsWith(PATH_PREFIX)) {
      return true;
    }
    String token = BearerTokens.extract(request.getHeader("Authorization"));
    return token == null || !token.startsWith(RT_PREFIX);
  }

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain chain)
      throws ServletException, IOException {
    try {
      // shouldNotFilter 와 같은 도우미로 꺼낸다 — 여기 왔으면 rt_ 로 시작하는 토큰이 있다.
      String plaintext = BearerTokens.extract(request.getHeader("Authorization"));
      authenticator
          .authenticate(plaintext)
          .filter(a -> tenantStatusChecker.isActive(a.tenantId()))
          .ifPresent(
              a -> {
                TenantContext.set(a.tenantId());
                SecurityContextHolder.getContext()
                    .setAuthentication(
                        new UsernamePasswordAuthenticationToken(
                            a.principal(), null, List.of(new SimpleGrantedAuthority(ROLE))));
              });
      chain.doFilter(request, response);
    } finally {
      TenantContext.clear();
    }
  }
}
