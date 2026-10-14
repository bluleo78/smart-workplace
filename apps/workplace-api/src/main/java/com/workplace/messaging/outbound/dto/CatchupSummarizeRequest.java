package com.workplace.messaging.outbound.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.workplace.global.ai.AiMemoryLine;
import java.util.List;

/**
 * ai-agent /messaging/catchup 요청 — 안 읽은 메시지(근거 인용용 id 포함) + 실행 설정. memories — WP-381 요청자의 공통 + 메신저
 * 메모리(읽기 전용 블록, null 이면 생략).
 */
public record CatchupSummarizeRequest(
    List<Msg> messages,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs,
    @JsonInclude(JsonInclude.Include.NON_NULL) List<AiMemoryLine> memories) {

  /** 캐치업 요약을 위한 개별 메시지 — 근거 인용 추적용 id 포함. */
  public record Msg(long id, String authorName, String body) {}
}
