package com.workplace.global.security;

import com.workplace.global.tenant.TenantContext;
import com.workplace.global.tenant.TenantStatusChecker;
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
  // WP-341: 정지·삭제된 테넌트의 기존 액세스 토큰을 즉시 막기 위한 상태 확인(짧은 TTL 캐시).
  private final TenantStatusChecker tenantStatusChecker;

  public JwtAuthenticationFilter(
      JwtTokenProvider jwtTokenProvider,
      @Lazy PermissionService permissionService,
      MembershipRepository membershipRepository,
      @Value("${workplace.ai-agent.internal-token:}") String internalToken,
      TenantStatusChecker tenantStatusChecker) {
    this.jwtTokenProvider = jwtTokenProvider;
    this.permissionService = permissionService;
    this.membershipRepository = membershipRepository;
    this.internalToken = internalToken;
    this.tenantStatusChecker = tenantStatusChecker;
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
      // 플랫폼(운영자) 토큰: tenant 없음 → TenantContext 미설정. 권한은 테넌트 RBAC 가 아니라
      // ROLE_PLATFORM authority 로 부여한다(SecurityConfig 의 /api/platform/** hasRole 게이트용).
      if (jwtTokenProvider.isPlatformToken(token)) {
        setPlatformSecurityContext(userId);
        return;
      }
      // active-tenant 클레임이 있으면 요청 스코프에 설정(RLS GUC 주입용). 없으면 fail-closed.
      Long tenantId = jwtTokenProvider.getTenantIdFromToken(token);
      // WP-341: 정지·삭제·영구 삭제 중인 테넌트의 기존 토큰은 인증을 세우지 않는다(→ 401). 웹은 401 에서 refresh 를
      // 시도하고 refresh 는 ACTIVE 게이트에서 막혀 로그아웃 흐름으로 이어진다(필터가 응답 바디를 직접 쓰지 않는다).
      if (tenantId != null && !tenantStatusChecker.isActive(tenantId)) {
        return;
      }
      // WP-48: 브라우저 JWT 세션은 항상 인증 수단을 details 로 운반한다(amr 없으면 비밀번호 세션).
      // select-tenant/memberships 는 details 가 없는 PAT·API 키·Internal 인증을 거부하고, SSO 세션은 SSO 켜진
      // 워크스페이스로 제한한다.
      String amr = jwtTokenProvider.getAuthMethodFromToken(token);
      AuthDetails details = new AuthDetails(amr != null ? amr : AuthDetails.PASSWORD);
      if (tenantId == null) {
        // tenant 없는 토큰(소속 없음 안내·워크스페이스 선택 전)은 판정할 멤버십이 없으므로 기존 그대로.
        setSecurityContext(userId, details);
        return;
      }
      // TenantContext 를 먼저 설정해야 권한 조회(@Transactional doBegin)가 GUC 를 주입받아 RLS 하에서 조회한다.
      TenantContext.set(tenantId);
      // WP-420: 이 tenant 의 멤버십이 ACTIVE 가 아니면(관리자가 정지) 이미 발급된 토큰도 즉시 인증을 세우지 않는다(→ 401).
      // 멤버십 판정과 권한 조회는 한 왕복이다. WP-341 과 같이 응답 바디는 쓰지 않는다 — 웹은 401 에서 refresh 를 시도하고, refresh 는
      // ACTIVE 멤버십만 다시 고르므로 다른 워크스페이스로 옮기거나 로그아웃 흐름으로 이어진다. 정지된 tenant 로 permitAll 엔드포인트가
      // 실행되지 않도록 TenantContext 도 되돌린다.
      var permissions = permissionService.getActiveMemberPermissions(userId);
      if (permissions.isEmpty()) {
        TenantContext.clear();
        return;
      }
      setAuthentication(userId, permissions.get(), details);
    }
  }

  /** 플랫폼 운영자 인증 컨텍스트 — ROLE_PLATFORM authority 단일 부여(테넌트 권한 조회 안 함). */
  private void setPlatformSecurityContext(Long userId) {
    var authentication =
        new UsernamePasswordAuthenticationToken(
            userId, null, List.of(new SimpleGrantedAuthority("ROLE_PLATFORM")));
    SecurityContextHolder.getContext().setAuthentication(authentication);
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
      // 토큰에 tenant 가 없으므로, 선택적 X-On-Behalf-Of-Tenant 헤더(ACTIVE 멤버십 검증) 또는 단일 멤버십으로 해석한다.
      // TenantContext 를 먼저 설정해야 setSecurityContext→getUserPermissions(@Transactional doBegin)가
      // GUC 를 주입받아 RLS 하에서 권한을 정상 조회한다.
      var memberships = membershipRepository.findActiveByUser(userId);
      switch (AgentTenantResolver.resolve(
          memberships, request.getHeader(AgentTenantResolver.TENANT_HEADER))) {
        case AgentTenantResolver.Rejected() -> {
          return; // 명시 테넌트 미해석 → 401 (WP-420)
        }
        case AgentTenantResolver.NoTenant() -> {}
        case AgentTenantResolver.Resolved(long tenantId) -> TenantContext.set(tenantId);
      }
      // NoTenant(헤더 없이 0/다중)는 테넌트 없는 인증 — 3상태 의미는 AgentTenantResolver.Resolution 참고.
      // WP-55: Internal 대행 표식 — AuthDetails 가 아니므로 브라우저 세션으로 오인되지 않는다(InternalOnBehalfOf 참고).
      setSecurityContext(userId, InternalOnBehalfOf.INSTANCE);
    } catch (NumberFormatException ignored) {
      // Invalid userId, skip authentication
    }
  }

  /**
   * 인증 컨텍스트 설정 — details 는 인증 수단 표식(브라우저 JWT=AuthDetails, Internal 대행=InternalOnBehalfOf, 그 외
   * null).
   */
  private void setSecurityContext(Long userId, Object details) {
    setAuthentication(userId, permissionService.getUserPermissions(userId), details);
  }

  /** 이미 조회한 권한으로 인증 컨텍스트를 세운다(WP-420: JWT tenant 경로는 멤버십 판정과 함께 얻은 권한을 그대로 쓴다). */
  private void setAuthentication(Long userId, Set<String> permissions, Object details) {
    List<SimpleGrantedAuthority> authorities =
        permissions.stream().map(SimpleGrantedAuthority::new).toList();
    UsernamePasswordAuthenticationToken authentication =
        new UsernamePasswordAuthenticationToken(userId, null, authorities);
    if (details != null) {
      authentication.setDetails(details);
    }
    SecurityContextHolder.getContext().setAuthentication(authentication);
  }
}
