package com.workplace.issue.outbound.dto;

import java.util.List;

/** ai-agent /issue/progress-summary 요청. dueDate 는 ISO(yyyy-MM-dd) 또는 null. */
public record IssueSummaryRequest(
    String title,
    String status,
    String priority,
    String dueDate,
    List<CommentLine> comments,
    List<HistoryLine> history,
    long assistantAgentId,
    String model,
    int maxTurns,
    long timeoutMs) {

  public record CommentLine(String authorName, String body, String createdAt) {}

  public record HistoryLine(
      String actorName, String eventType, String fromValue, String toValue, String createdAt) {}
}
