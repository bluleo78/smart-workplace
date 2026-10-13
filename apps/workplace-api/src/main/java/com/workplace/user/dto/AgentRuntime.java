package com.workplace.user.dto;

/**
 * AI 에이전트(kind=AGENT)의 실행 방식 (WP-371).
 *
 * <p>INTERNAL = 서버의 ai-agent 서비스가 Claude 로 대신 실행(기본). EXTERNAL = 외부 에이전트(예: 개인 PC 의 Claude Code)가
 * 에이전트 API 키로 직접 일하며, 서버는 해당 에이전트 몫의 이벤트를 ai-agent 로 보내지 않는다.
 */
public final class AgentRuntime {

  private AgentRuntime() {}

  public static final String INTERNAL = "INTERNAL";
  public static final String EXTERNAL = "EXTERNAL";

  /** 요청 검증(@Pattern)용 허용값 정규식 — 상수에서 만들어 값 목록이 갈라지지 않게 한다(컴파일 타임 상수라 애너테이션에 쓸 수 있다). */
  public static final String PATTERN = INTERNAL + "|" + EXTERNAL;
}
