package com.workplace.home.outbound.dto;

import java.util.List;

/** ai-agent POST /home/priority-classify 응답. */
public record PriorityClassifyResult(List<ScoreLine> results) {

  /**
   * 후보 1건의 AI 판단 — importanceScore/urgencyScore 는 0~100.
   *
   * <p>sourceId 는 이슈/알림/메일/대화 4개의 독립된 BIGSERIAL 시퀀스에서 온 원시 PK 라 단독으로는 충돌한다(예: 이슈#1과 알림#1이 둘 다
   * sourceId="1"). sourceType 을 함께 받아 (sourceType, sourceId) 복합키로만 후보를 식별한다.
   */
  public record ScoreLine(
      String sourceType, String sourceId, int importanceScore, int urgencyScore, String reason) {}
}
