package com.workplace.global.security;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.permission.service.PermissionService;
import com.workplace.tenant.repository.MembershipRepository;
import com.workplace.user.dto.UserKind;
import com.workplace.user.repository.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Phase 5a — AGENT API 키 (`Bearer ak_...`) 인증 필터. SHA-256 해시로 매칭하고 활성 키만 통과시킨다. 인증 성공 시 AGENT 유저의
 * 권한도 함께 로딩하며 last_used_at 을 동기 갱신한다. JWT 필터보다 먼저 등록된다.
 */
@Component
@Slf4j
public class ApiKeyAuthenticationFilter extends OncePerRequestFilter {

  private static final String BEARER_PREFIX = "Bearer ";
  private static final String AK_PREFIX = "ak_";

  private final AgentApiKeyRepository agentApiKeyRepository;
  private final UserRepository userRepository;
  private final PermissionService permissionService;
  private final MembershipRepository membershipRepository;

  public ApiKeyAuthenticationFilter(
      AgentApiKeyRepository agentApiKeyRepository,
      UserRepository userRepository,
      @Lazy PermissionService permissionService,
      MembershipRepository membershipRepository) {
    this.agentApiKeyRepository = agentApiKeyRepository;
    this.userRepository = userRepository;
    this.permissionService = permissionService;
    this.membershipRepository = membershipRepository;
  }

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain chain)
      throws ServletException, IOException {
    // active-tenant ThreadLocal 이 풀링 스레드로 새지 않도록, 인증 + 다운스트림 처리 전체를 try 로 감싸고
    // finally 에서 항상 정리한다(키 미일치 시에도 안전 — clear 는 멱등). JwtAuthenticationFilter 패턴 미러.
    try {
      String auth = request.getHeader("Authorization");
      if (auth != null
          && auth.startsWith(BEARER_PREFIX)
          && auth.length() > BEARER_PREFIX.length()
          && auth.substring(BEARER_PREFIX.length()).startsWith(AK_PREFIX)) {
        String plaintext = auth.substring(BEARER_PREFIX.length());
        String hash = sha256Hex(plaintext);
        agentApiKeyRepository
            .findActiveByHash(hash)
            .ifPresent(
                key ->
                    userRepository
                        .findById(key.userId())
                        .filter(u -> UserKind.isAgent(u.kind()))
                        .ifPresent(
                            user -> {
                              // AGENT 경로도 active-tenant 를 요청 스코프에 설정해야 RLS GUC 가 주입되어
                              // user_role/role_permission 조회(getUserPermissions)가 권한을 반환한다. API 키에는
                              // tenant 가 없으므로 X-On-Behalf-Of-Tenant 헤더(멤버십 검증) 또는 단일 멤버십으로 해석한다.
                              // 비멤버 헤더/0/다중·미해석이면 미설정 → fail-closed. 반드시 getUserPermissions 호출 전에
                              // 설정.
                              var memberships = membershipRepository.findActiveByUser(user.id());
                              Long resolved =
                                  AgentTenantResolver.resolve(
                                      memberships,
                                      request.getHeader(AgentTenantResolver.TENANT_HEADER));
                              if (resolved != null) {
                                TenantContext.set(resolved);
                              }

                              // AGENT 의 명시적 권한 + ROLE_AGENT 마커
                              List<SimpleGrantedAuthority> authorities = new ArrayList<>();
                              permissionService
                                  .getUserPermissions(user.id())
                                  .forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
                              authorities.add(new SimpleGrantedAuthority("ROLE_AGENT"));
                              UsernamePasswordAuthenticationToken token =
                                  new UsernamePasswordAuthenticationToken(
                                      user.id(), null, authorities);
                              SecurityContextHolder.getContext().setAuthentication(token);
                              agentApiKeyRepository.touchLastUsed(key.id());
                            }));
      }
      chain.doFilter(request, response);
    } finally {
      // 풀링된 스레드로 active-tenant ThreadLocal 이 새지 않도록 요청 종료 시 항상 정리한다.
      TenantContext.clear();
    }
  }

  private String sha256Hex(String plaintext) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-256");
      byte[] hash = md.digest(plaintext.getBytes(StandardCharsets.UTF_8));
      return HexFormat.of().formatHex(hash);
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 미지원", e);
    }
  }
}
