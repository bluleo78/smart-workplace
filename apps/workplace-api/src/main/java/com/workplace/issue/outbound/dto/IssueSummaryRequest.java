package com.workplace.issue.outbound.dto;

import java.util.List;

/**
 * ai-agent /issue/progress-summary 요청. dueDate 는 ISO(yyyy-MM-dd) 또는 null.
 *
 * <p>{@code statusName} 은 프로젝트 사용자 정의 상태 이름(WP-869, 없으면 null) — AI 가 범주 코드(IN_PROGRESS) 대신 「검토 중」
 * 같은 이름으로 현황을 말하게 한다. 예전 ai-agent 는 모르는 키를 무시한다.
 */
public record IssueSummaryRequest(
    String title,
    String body,
    String status,
    String statusName,
    String priority,
    String dueDate,
    List<CommentLine> comments,
    List<HistoryLine> history,
    List<ChatLine> chat,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {

  public record CommentLine(String authorName, String body, String createdAt) {}

  public record HistoryLine(
      String actorName, String eventType, String fromValue, String toValue, String createdAt) {}

  /** 이슈 채팅 1줄 — authorKind 로 USER/AGENT 구분. */
  public record ChatLine(String author, String kind, String body, String createdAt) {}
}
