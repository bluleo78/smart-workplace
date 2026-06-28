package com.workplace.issue.outbound.dto;

import java.util.List;

/** ai-agent /issue/progress-summary 요청. dueDate 는 ISO(yyyy-MM-dd) 또는 null. */
public record IssueSummaryRequest(
    String title,
    String body,
    String status,
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
