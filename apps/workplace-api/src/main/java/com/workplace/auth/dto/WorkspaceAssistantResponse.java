package com.workplace.auth.dto;

/**
 * 공용 비서 상태. 미지정이면 agentUserId=null. suggestionModel — 추천 질문 전용 모델(WP-139, null=자동),
 * suggestionModelAuto — 자동일 때 실제로 쓸 모델(연결 없음=null).
 */
public record WorkspaceAssistantResponse(
    Long agentUserId,
    String agentName,
    boolean hasActiveToken,
    String model,
    String thinkingDepth,
    String suggestionModel,
    String suggestionModelAuto) {}
