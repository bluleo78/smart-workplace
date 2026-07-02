package com.workplace.global.security;

import com.workplace.auth.repository.UserApiTokenRepository;
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
 * 사용자 PAT(`Bearer swp_...`) 인증 필터. SHA-256 해시로 매칭하고 활성(미회수·미만료) 토큰만 통과시킨다. 토큰에 바인딩된 테넌트가 사용자의
 * ACTIVE 멤버십에 있을 때만 TenantContext 를 설정한다(불일치 → 미인증, fail-closed). ApiKeyAuthenticationFilter(ak_)
 * 미러 — AGENT 전용 kind 체크 대신 HUMAN(비 AGENT)만 허용한다. JWT 필터보다 먼저 등록된다.
 */
@Component
@Slf4j
public class UserTokenAuthenticationFilter extends OncePerRequestFilter {

  private static final String BEARER_PREFIX = "Bearer ";
  private static final String SWP_PREFIX = "swp_";

  private final UserApiTokenRepository userApiTokenRepository;
  private final UserRepository userRepository;
  private final PermissionService permissionService;
  private final MembershipRepository membershipRepository;

  public UserTokenAuthenticationFilter(
      UserApiTokenRepository userApiTokenRepository,
      UserRepository userRepository,
      @Lazy PermissionService permissionService,
      MembershipRepository membershipRepository) {
    this.userApiTokenRepository = userApiTokenRepository;
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
    // finally 에서 항상 정리한다(토큰 미일치 시에도 안전 — clear 는 멱등). ApiKeyAuthenticationFilter 패턴 미러.
    try {
      String auth = request.getHeader("Authorization");
      if (auth != null
          && auth.startsWith(BEARER_PREFIX)
          && auth.length() > BEARER_PREFIX.length()
          && auth.substring(BEARER_PREFIX.length()).startsWith(SWP_PREFIX)) {
        String plaintext = auth.substring(BEARER_PREFIX.length());
        String hash = sha256Hex(plaintext);
        userApiTokenRepository
            .findActiveByHash(hash)
            .ifPresent(
                tok ->
                    userRepository
                        .findById(tok.userId())
                        .filter(u -> !UserKind.isAgent(u.kind())) // PAT 는 사람 전용
                        .ifPresent(
                            user -> {
                              // 토큰의 테넌트가 실제 ACTIVE 멤버십에 있을 때만 채택 — 멤버십 해지 시
                              // 즉시 무효.
                              var memberships = membershipRepository.findActiveByUser(user.id());
                              boolean member =
                                  memberships.stream()
                                      .anyMatch(m -> m.tenantId().equals(tok.tenantId()));
                              if (!member) return; // fail-closed: 인증 미설정 → 401

                              // 반드시 getUserPermissions 전에 설정 — GUC 주입 후 권한 조회.
                              TenantContext.set(tok.tenantId());

                              List<SimpleGrantedAuthority> authorities = new ArrayList<>();
                              permissionService
                                  .getUserPermissions(user.id())
                                  .forEach(p -> authorities.add(new SimpleGrantedAuthority(p)));
                              UsernamePasswordAuthenticationToken token =
                                  new UsernamePasswordAuthenticationToken(
                                      user.id(), null, authorities);
                              SecurityContextHolder.getContext().setAuthentication(token);
                              userApiTokenRepository.touchLastUsed(tok.id());
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
