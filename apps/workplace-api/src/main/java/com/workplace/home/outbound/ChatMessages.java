package com.workplace.home.outbound;

import java.util.List;

/** ai-agent /ai/compose 요청 계약 (7b). 응답은 SSE 스트림으로 받으므로 본 파일은 요청 본문만 정의한다. */
public final class ChatMessages {
  private ChatMessages() {}

  /**
   * compose 요청 본문. recentContext 는 follow-up 연속성용 텍스트 전용 맥락. 비서 사양은 resolver 가 해석해 적재. userId — 요청
   * 사용자 ID. ai-agent 가 MCP 도구(드라이브·캘린더 등) 컨텍스트를 assistantAgentId 아닌 실제 요청자 기준으로 실행하기 위해 전달한다(refs
   * #376).
   */
  public record ChatRequest(
      String query,
      List<ContextMessage> recentContext,
      long assistantAgentId,
      long userId,
      String model,
      String thinkingDepth,
      int maxTurns,
      int timeoutMs) {}

  /** 세션 최근 메시지(텍스트만 — 위젯 jsonb 제외). */
  public record ContextMessage(String role, String content) {}
}
