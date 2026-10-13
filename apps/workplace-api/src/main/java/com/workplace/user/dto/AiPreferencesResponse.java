package com.workplace.user.dto;

/** 사용자 AI 사용 설정(WP-139). suggestionsEnabled — 빈 대화 추천·답 뒤 후속 질문을 보일지. */
public record AiPreferencesResponse(boolean suggestionsEnabled) {}
