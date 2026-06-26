package com.workplace.messaging.outbound.dto;

import java.util.List;

/** ai-agent /messaging/catchup 요청 — 안 읽은 메시지(근거 인용용 id 포함) + 실행 설정. */
public record CatchupSummarizeRequest(
    List<Msg> messages, long assistantAgentId, String model, int maxTurns, long timeoutMs) {
  /** 캐치업 요약을 위한 개별 메시지 — 근거 인용 추적용 id 포함. */
  public record Msg(long id, String authorName, String body) {}
}
