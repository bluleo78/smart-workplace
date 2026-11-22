package com.workplace.global.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * AI 키({@code ak_}) 인증이 Authentication details 에 싣는 정보(WP-2008) — 어떤 키로 들어왔는지. 이벤트 스트림이 열 때 키 id 를
 * 기억해 두었다가, 키가 폐기되면 그 키로 연 스트림만 닫기 위해 쓴다.
 *
 * @param keyId 인증에 쓴 AI 키의 id
 */
public record AgentKeyAuthDetails(long keyId) {

  /** 현재 요청이 AI 키 인증이면 그 키 id, 아니면(JWT·PAT·미인증) null. */
  public static Long currentKeyId() {
    Authentication auth = SecurityContextHolder.getContext().getAuthentication();
    if (auth != null && auth.getDetails() instanceof AgentKeyAuthDetails d) return d.keyId();
    return null;
  }
}
