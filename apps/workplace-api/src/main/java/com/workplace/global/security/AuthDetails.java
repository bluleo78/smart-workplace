package com.workplace.global.security;

import org.springframework.security.access.AccessDeniedException;
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

  /**
   * 웹 로그인 세션이 아니면 403(WP-845) — 권한·자격 증명을 새로 만드는 관리 동작용. {@link RequireWebSession} 과 그 밖의 진입점(확인 카드
   * 승인 등)이 같은 기준·문구를 쓴다.
   */
  public static void requireWebSession(Authentication authentication) {
    if (methodOf(authentication) == null) {
      throw new AccessDeniedException("이 작업은 웹 로그인 세션에서만 할 수 있습니다 — API 토큰·AI 키로는 할 수 없습니다");
    }
  }
}
