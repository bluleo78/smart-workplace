package com.workplace.global.security;

import org.springframework.security.core.Authentication;

/**
 * 요청의 인증 수단(JWT amr 클레임)을 Authentication details 로 운반한다(WP-48).
 *
 * <p>principal 은 기존대로 {@code Long userId} 를 유지해야 수많은 컨트롤러의 {@code (Long) getPrincipal()} 캐스팅이 깨지지
 * 않는다. 그래서 인증 수단은 details 에 싣는다. 브라우저 JWT 세션은 항상 details 를 가진다(amr 없으면 {@link #PASSWORD}). PAT·API
 * 키·Internal 인증은 details 가 없으므로 {@link #methodOf} 가 null — 브라우저 세션 전용 API(워크스페이스 선택 등)는 이를 거부한다.
 */
public record AuthDetails(String authMethod) {

  public static final String SSO = "sso";

  /** 비밀번호 로그인 브라우저 세션(amr 클레임 없는 JWT). 토큰에는 쓰지 않고 요청 details 로만 쓴다. */
  public static final String PASSWORD = "pwd";

  /** 인증 수단. details 가 없거나 다른 타입이면 null(브라우저 JWT 세션이 아님 — PAT·API 키·Internal). */
  public static String methodOf(Authentication authentication) {
    if (authentication != null && authentication.getDetails() instanceof AuthDetails d) {
      return d.authMethod();
    }
    return null;
  }
}
