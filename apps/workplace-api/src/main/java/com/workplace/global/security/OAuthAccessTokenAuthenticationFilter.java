package com.workplace.global.security;

import com.workplace.auth.oauth.repository.OAuthConnectionRepository;
import com.workplace.auth.oauth.repository.OAuthTokenRepository;
import com.workplace.auth.oauth.service.OAuthTokenService;
import com.workplace.global.tenant.TenantContext;
import com.workplace.global.util.CapabilityTokens;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.OffsetDateTime;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * OAuth access 토큰(`Bearer swo_...`) 인증 필터(WP-1685). Claude 앱 커넥터 등 OAuth 클라이언트가 받은 access 토큰을
 * SHA-256 해시로 찾아, 살아 있는(미폐기·미만료) ACCESS 행이고 그 연결도 끊기지 않았을 때만 연결의 (사용자, 워크스페이스)로 인증한다. 사람·멤버십·테넌트
 * 판정은 PAT 필터와 같은 {@link HumanTokenAuthenticator} 를 쓴다 — 멤버십을 해지하거나 연결을 끊으면 바로 401.
 *
 * <p>{@code swr_}(refresh)는 어떤 필터도 받지 않는다 — 접두사가 달라 여기서 건너뛰고, JWT 검증도 실패해 401 이 된다. AI 키·PAT·runner
 * 필터처럼 JWT 필터보다 먼저 등록된다(접두사로 상호 배타).
 */
@Component
public class OAuthAccessTokenAuthenticationFilter extends OncePerRequestFilter {

  private final OAuthTokenRepository oauthTokenRepository;
  private final OAuthConnectionRepository oauthConnectionRepository;
  private final HumanTokenAuthenticator humanTokenAuthenticator;

  public OAuthAccessTokenAuthenticationFilter(
      OAuthTokenRepository oauthTokenRepository,
      OAuthConnectionRepository oauthConnectionRepository,
      HumanTokenAuthenticator humanTokenAuthenticator) {
    this.oauthTokenRepository = oauthTokenRepository;
    this.oauthConnectionRepository = oauthConnectionRepository;
    this.humanTokenAuthenticator = humanTokenAuthenticator;
  }

  @Override
  protected void doFilterInternal(
      @NonNull HttpServletRequest request,
      @NonNull HttpServletResponse response,
      @NonNull FilterChain chain)
      throws ServletException, IOException {
    // PAT 필터와 같이 인증 + 다운스트림 처리 전체를 try 로 감싸, 풀링 스레드로 ThreadLocal 이 새지 않게 finally 에서 정리한다.
    try {
      // Bearer scheme 은 대소문자 무관(RFC 7235, WP-1431). swo_ 로 시작하는 토큰만 이 필터가 맡는다.
      String plaintext = BearerTokens.extract(request.getHeader("Authorization"));
      if (plaintext != null && plaintext.startsWith(OAuthTokenService.ACCESS_PREFIX)) {
        OffsetDateTime now = OffsetDateTime.now();
        oauthTokenRepository
            .findActiveAccess(CapabilityTokens.sha256Hex(plaintext), now)
            .ifPresent(
                access -> {
                  // 인증에 성공했을 때만 연결의 마지막 사용 시각을 남긴다. 함께 읽은 값이 1분 안이면 UPDATE 왕복 자체를 건너뛴다(리뷰 F6 —
                  // 동시 요청끼리의 경합은 touchLastUsed 의 SQL 조건이 막는다).
                  if (humanTokenAuthenticator.authenticate(
                          request, access.userId(), access.tenantId())
                      && OAuthConnectionRepository.isLastUsedTouchDue(access.lastUsedAt(), now)) {
                    oauthConnectionRepository.touchLastUsed(access.connectionId());
                  }
                });
      }
      chain.doFilter(request, response);
    } finally {
      TenantContext.clear();
      AgentToolContext.clear();
    }
  }
}
