package com.workplace.auth.service;

/**
 * 비서 연결 provider(ai_agent_credential.provider) 정규화 규칙 한 곳(WP-139) — 미기록(NULL, V119 이전 레거시)·미지정 요청은
 * anthropic 으로 본다. 등록 요청 기본값·이전 연결 비교·추천 모델 결정이 같은 규칙을 쓰게 모았다.
 */
public final class AgentProviders {

  /** Anthropic provider 값. */
  public static final String ANTHROPIC = "anthropic";

  private AgentProviders() {}

  /** Anthropic 연결인가 — NULL 은 anthropic. */
  public static boolean isAnthropic(String provider) {
    return provider == null || ANTHROPIC.equals(provider);
  }

  /** 비교·저장용 정규화 — NULL 이면 anthropic, 그 외는 그대로. */
  public static String normalize(String provider) {
    return provider == null ? ANTHROPIC : provider;
  }
}
