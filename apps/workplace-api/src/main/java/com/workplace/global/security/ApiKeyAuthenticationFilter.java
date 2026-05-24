package com.workplace.global.security;

import com.workplace.auth.repository.AgentApiKeyRepository;
import com.workplace.permission.service.PermissionService;
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

  public ApiKeyAuthenticationFilter(
      AgentApiKeyRepository agentApiKeyRepository,
      UserRepository userRepository,
      @Lazy PermissionService permissionService) {
    this.agentApiKeyRepository = agentApiKeyRepository;
    this.userRepository = userRepository;
    this.permissionService = permissionService;
  }

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain chain)
      throws ServletException, IOException {
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
