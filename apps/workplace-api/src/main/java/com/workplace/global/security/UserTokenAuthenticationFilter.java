package com.workplace.global.security;

import com.workplace.auth.repository.UserApiTokenRepository;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 사용자 PAT(`Bearer swp_...`) 인증 필터. SHA-256 해시로 매칭하고 활성(미회수·미만료) 토큰만 통과시킨다. 토큰에 바인딩된 테넌트가 사용자의
 * ACTIVE 멤버십에 있을 때만 TenantContext 를 설정한다(불일치 → 미인증, fail-closed). ApiKeyAuthenticationFilter(ak_)
 * 미러 — AGENT 전용 kind 체크 대신 HUMAN(비 AGENT)만 허용한다. JWT 필터보다 먼저 등록된다. 사람·멤버십·테넌트 판정과 인증 주체 설정은 OAuth
 * access 필터와 같은 {@link HumanTokenAuthenticator} 를 쓴다(WP-1685).
 */
@Component
@Slf4j
public class UserTokenAuthenticationFilter extends OncePerRequestFilter {

  private static final String SWP_PREFIX = "swp_";

  private final UserApiTokenRepository userApiTokenRepository;
  private final HumanTokenAuthenticator humanTokenAuthenticator;

  public UserTokenAuthenticationFilter(
      UserApiTokenRepository userApiTokenRepository,
      HumanTokenAuthenticator humanTokenAuthenticator) {
    this.userApiTokenRepository = userApiTokenRepository;
    this.humanTokenAuthenticator = humanTokenAuthenticator;
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
      // Bearer scheme 은 대소문자 무관으로 판정한다(RFC 7235, WP-1431). swp_ 로 시작하는 토큰만 이 필터가 맡는다.
      String plaintext = BearerTokens.extract(request.getHeader("Authorization"));
      if (plaintext != null && plaintext.startsWith(SWP_PREFIX)) {
        String hash = CapabilityTokens.sha256Hex(plaintext);
        userApiTokenRepository
            .findActiveByHash(hash)
            .ifPresent(
                tok -> {
                  // 사람 전용·ACTIVE 멤버십·활성 테넌트를 모두 만족할 때만 인증되고, 그때만 사용 시각을 남긴다.
                  if (humanTokenAuthenticator.authenticate(request, tok.userId(), tok.tenantId())) {
                    userApiTokenRepository.touchLastUsed(tok.id());
                  }
                });
      }
      chain.doFilter(request, response);
    } finally {
      // 풀링된 스레드로 active-tenant ThreadLocal 이 새지 않도록 요청 종료 시 항상 정리한다.
      TenantContext.clear();
      AgentToolContext.clear();
    }
  }
}
