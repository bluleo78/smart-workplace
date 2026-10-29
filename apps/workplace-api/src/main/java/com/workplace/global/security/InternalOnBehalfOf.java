package com.workplace.global.security;

import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;

/**
 * Internal 토큰 + X-On-Behalf-Of(ai-agent 대행) 인증 표식(WP-55) — Authentication.details 에 싣는다.
 *
 * <p>{@link AuthDetails} 와 다른 타입이라 {@link AuthDetails#methodOf} 는 여전히 null 을 돌려준다 — 브라우저 세션 전용
 * API(워크스페이스 선택)는 계속 거부하고, "details 없음 = AI 경로" 로 보는 위키 저장 판정도 그대로다. PAT·API 키와 구분해 "대행 호출일 때만" 허용할
 * 동작(AI 메모리의 source:'AI')에 쓴다.
 */
public enum InternalOnBehalfOf {
  INSTANCE;

  /** 이 요청이 ai-agent 의 Internal 대행 호출인가. */
  public static boolean isInternal(Authentication authentication) {
    return authentication != null && authentication.getDetails() == INSTANCE;
  }

  /** ai-agent 대행 호출이 아니면 403(message) — ai-agent 전용 엔드포인트의 첫 줄(WP-1191). */
  public static void requireInternal(Authentication authentication, String message) {
    if (!isInternal(authentication)) throw new AccessDeniedException(message);
  }
}
