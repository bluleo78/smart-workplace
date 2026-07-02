package com.workplace.home.dto;

/** GET /me/priority-items 응답 항목. */
public record PriorityItemResponse(
    String sourceType,
    String sourceId,
    String title,
    String deepLink,
    int importanceScore,
    int urgencyScore,
    String reason) {

  /** 저장된 우선순위 행을 응답 DTO 로 변환. */
  public static PriorityItemResponse from(PriorityItemRow r) {
    return new PriorityItemResponse(
        r.sourceType(),
        r.sourceId(),
        r.title(),
        r.deepLink(),
        r.importanceScore(),
        r.urgencyScore(),
        r.reason());
  }
}
