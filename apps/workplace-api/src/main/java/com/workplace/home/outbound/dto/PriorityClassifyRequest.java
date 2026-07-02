package com.workplace.home.outbound.dto;

import java.util.List;

/** ai-agent POST /home/priority-classify 요청. 배치 1콜에 후보 전체를 담는다. */
public record PriorityClassifyRequest(
    List<CandidateLine> items, long assistantAgentId, String model, int maxTurns, long timeoutMs) {

  /** 분류 대상 후보 1건 — context 는 AI 판단에 참고할 짧은 부연설명(예: "마감 지남"). */
  public record CandidateLine(String sourceType, String sourceId, String title, String context) {}
}
