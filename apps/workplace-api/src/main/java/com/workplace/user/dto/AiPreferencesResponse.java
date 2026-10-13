package com.workplace.user.dto;

/**
 * 사용자 AI 사용 설정(WP-139·WP-55). suggestionsEnabled — 빈 대화 추천·답 뒤 후속 질문. memoryEnabled — 메모리 저장·대화 반영.
 */
public record AiPreferencesResponse(boolean suggestionsEnabled, boolean memoryEnabled) {}
