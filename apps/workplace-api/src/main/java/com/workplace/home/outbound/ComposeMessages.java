package com.workplace.home.outbound;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.List;

/** ai-agent /home/compose 요청/응답 계약 (7b). */
public final class ComposeMessages {
  private ComposeMessages() {}

  /** compose 요청 본문. recentContext 는 follow-up 연속성용 텍스트 전용 맥락. */
  public record ComposeRequest(String query, List<ContextMessage> recentContext) {}

  /** 세션 최근 메시지(텍스트만 — 위젯 jsonb 제외). */
  public record ContextMessage(String role, String content) {}

  /** compose 응답. widgets 는 JSON 배열(JsonNode 로 받아 그대로 영속·반환). */
  public record ComposeResult(String message, JsonNode widgets) {}
}
