package com.workplace.messaging.outbound.dto;

import java.util.List;

/** ai-agent /messaging/catchup 응답 — 결정/오간이야기 묶음, 각 묶음은 근거 메시지 id 동반. */
public record CatchupSummarizeResult(List<Group> decisions, List<Group> discussion) {
  /** AI 요약 한 항목 — 텍스트 + 근거 메시지 id 목록(환각 방지용). */
  public record Group(String text, List<Long> sourceMessageIds) {}
}
