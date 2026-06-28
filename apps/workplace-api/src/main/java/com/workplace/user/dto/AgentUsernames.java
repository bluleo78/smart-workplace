package com.workplace.user.dto;

/**
 * 개인 비서 AGENT 의 username 규칙. 사용자별 개인 비서는 결정적 username(`__assistant_u{userId}`)으로 생성되며, 이 접두어가 곧 "이
 * AGENT 는 개인 비서다"의 단일 식별 기준이다.
 *
 * <p>접두어는 (1) 워크스페이스 에이전트 관리 목록 제외, (2) 에이전트 유형(PERSONAL) 판별, (3) 관리자 rename 거부/예약 username 차단의
 * load-bearing 키라서, 리터럴을 여기 한 곳에만 둔다(복붙 드리프트 방지).
 */
public final class AgentUsernames {

  private AgentUsernames() {}

  /** 개인 비서 username 접두어 — 자동 프로비저닝 시 `접두어 + callerId` 로 생성된다. */
  public static final String PERSONAL_ASSISTANT_PREFIX = "__assistant_u";

  /** 주어진 username 이 개인 비서(자동 생성 AGENT)인지. null-safe. */
  public static boolean isPersonalAssistant(String username) {
    return username != null && username.startsWith(PERSONAL_ASSISTANT_PREFIX);
  }
}
