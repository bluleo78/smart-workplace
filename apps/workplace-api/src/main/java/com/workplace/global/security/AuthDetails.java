package com.workplace.global.security;

import org.springframework.security.core.Authentication;

/**
 * 요청의 인증 수단(JWT amr 클레임)을 Authentication details 로 운반한다(WP-48).
 *
 * <p>principal 은 기존대로 {@code Long userId} 를 유지해야 수많은 컨트롤러의 {@code (Long) getPrincipal()} 캐스팅이 깨지지
 * 않는다. 그래서 인증 수단은 details 에 싣는다. PAT·API 키·Internal 인증은 details 가 없으므로 비-SSO 로 취급된다.
 */
public record AuthDetails(String authMethod) {

  public static final String SSO = "sso";

  /** 인증 수단. details 가 없거나 다른 타입이면 null(비-SSO). */
  public static String methodOf(Authentication authentication) {
    if (authentication != null && authentication.getDetails() instanceof AuthDetails d) {
      return d.authMethod();
    }
    return null;
  }
}
