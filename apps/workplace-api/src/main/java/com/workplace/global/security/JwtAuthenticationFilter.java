package com.workplace.global.security;

import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.MessageDigest;
import java.util.List;
import java.util.Set;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
@Slf4j
public class JwtAuthenticationFilter extends OncePerRequestFilter {

  private final JwtTokenProvider jwtTokenProvider;
  private final PermissionService permissionService;
  private final MembershipRepository membershipRepository;
  private final String internalToken;

  public JwtAuthenticationFilter(
      JwtTokenProvider jwtTokenProvider,
      @Lazy PermissionService permissionService,
      MembershipRepository membershipRepository,
      @Value("${workplace.ai-agent.internal-token:}") String internalToken) {
    this.jwtTokenProvider = jwtTokenProvider;
    this.permissionService = permissionService;
    this.membershipRepository = membershipRepository;
    this.internalToken = internalToken;
  }

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain filterChain)
      throws ServletException, IOException {
    String authHeader = request.getHeader("Authorization");

    // JWT는 Authorization 헤더로만 받는다. 과거에는 EventSource API의 헤더 미지원 때문에
    // /api/v1/notifications/stream 엔드포인트에 한해 `?token=` 쿼리 파라미터 fallback을
    // 허용했으나, 토큰이 액세스 로그/프록시 로그/Referer/브라우저 히스토리에 노출되는
    // 위험이 있어 제거했다. 프론트엔드는 fetch + ReadableStream으로 SSE를 수신한다.
    String token = null;
    if (authHeader != null && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7);
    }

    // 인증 호출(authenticateWithJwt 내부에서 TenantContext.set 후 DB 조회)이 예외를 던져도
    // finally 가 실행되도록 인증 전체를 try 안에 둔다. 그래야 풀 스레드에 stale tenant 가
    // 남아 다음(특히 tenant 없는) 요청이 교차테넌트로 이를 물려받는 fail-open 을 막는다.
    try {
      if (token != null) {
        authenticateWithJwt(token);
      } else if (StringUtils.hasText(authHeader) && authHeader.startsWith("Internal ")) {
        authenticateWithInternalToken(authHeader.substring(9), request);
      }

      filterChain.doFilter(request, response);
    } finally {
      // 풀링된 스레드로 active-tenant ThreadLocal 이 새지 않도록 요청 종료 시 항상 정리한다.
      TenantContext.clear();
    }
  }

  private void authenticateWithJwt(String token) {
    if (jwtTokenProvider.validateAccessToken(token)) {
      Long userId = jwtTokenProvider.getUserIdFromToken(token);
      // active-tenant 클레임이 있으면 요청 스코프에 설정(RLS GUC 주입용). 없으면 fail-closed.
      Long tenantId = jwtTokenProvider.getTenantIdFromToken(token);
      if (tenantId != null) {
        TenantContext.set(tenantId);
      }
      setSecurityContext(userId);
    }
  }

  private void authenticateWithInternalToken(String token, HttpServletRequest request) {
    if (!StringUtils.hasText(internalToken)) return;

    // 길이가 다를 때 즉시 반환하면 타이밍 공격으로 길이를 유추할 수 있으므로
    // 길이 정규화 후 상수 시간 비교를 수행한다
    byte[] a = token.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    byte[] b = internalToken.getBytes(java.nio.charset.StandardCharsets.UTF_8);
    if (a.length != b.length || !MessageDigest.isEqual(a, b)) return;

    String onBehalfOf = request.getHeader("X-On-Behalf-Of");
    if (!StringUtils.hasText(onBehalfOf)) return;

    try {
      Long userId = Long.parseLong(onBehalfOf);
      // Internal(AI 에이전트) 경로도 active-tenant 를 요청 스코프에 설정해야 RLS GUC 가 주입된다.
      // JWT 경로(클레임)와 달리 토큰에 tenant 가 없으므로, 대상 사용자의 단일 활성 멤버십에서 해석한다.
      // (멀티 소속 에이전트의 명시적 테넌트 선택은 P4 후속. 0/다중이면 미설정 → fail-closed.)
      // TenantContext 를 먼저 설정해야 setSecurityContext→getUserPermissions(@Transactional doBegin)가
      // GUC 를 주입받아 RLS 하에서 권한을 정상 조회한다. (ApiKey 필터와 동일 불변식)
      var memberships = membershipRepository.findActiveByUser(userId);
      if (memberships.size() == 1) {
        TenantContext.set(memberships.get(0).tenantId());
      }
      setSecurityContext(userId);
    } catch (NumberFormatException ignored) {
      // Invalid userId, skip authentication
    }
  }

  private void setSecurityContext(Long userId) {
    Set<String> permissions = permissionService.getUserPermissions(userId);
    List<SimpleGrantedAuthority> authorities =
        permissions.stream().map(SimpleGrantedAuthority::new).toList();
    UsernamePasswordAuthenticationToken authentication =
        new UsernamePasswordAuthenticationToken(userId, null, authorities);
    SecurityContextHolder.getContext().setAuthentication(authentication);
  }
}
