package com.workplace.user.dto;

import java.util.Set;

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
  public static final Set<String> ALL = Set.of(INTERNAL, EXTERNAL);
}
