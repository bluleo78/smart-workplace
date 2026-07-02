package com.workplace.home.dto;

/** AI 가 산출한 항목 하나의 중요도/긴급도 점수. sourceType/sourceId 로 원본 식별. */
public record PriorityItemRow(
    String sourceType,
    String sourceId,
    String title,
    String deepLink,
    int importanceScore,
    int urgencyScore,
    String reason) {}
