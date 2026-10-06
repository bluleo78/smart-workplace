package com.workplace.home.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * GET /api/v1/ai/chat/active 응답(WP-190) — 호출자의 생성 중 대화와 동시 생성 상한. 새로고침·SSE 재연결 뒤 웹이 "답변 생성 중" 표시와
 * 상한 안내를 복원한다.
 */
public record HomeChatActiveResponse(int limit, List<Item> items) {

  /** 생성 중 대화 1건. */
  public record Item(UUID sessionId, String correlationId, Instant startedAt) {}
}
