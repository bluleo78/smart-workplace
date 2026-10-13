package com.workplace.user.dto;

/**
 * 사용자 AI 사용 설정 저장(WP-139·WP-55). 생략(null)한 값은 그대로 둔다 — 추천 카드와 메모리 카드가 각자 자기 값만 보내도 서로 덮지 않게. 둘 다
 * 없으면 컨트롤러가 400(실수로 아무것도 안 바꾸는 요청을 성공으로 보이지 않게).
 */
public record UpdateAiPreferencesRequest(Boolean suggestionsEnabled, Boolean memoryEnabled) {}
