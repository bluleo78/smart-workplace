package com.workplace.home.dto;

import jakarta.validation.Valid;

/**
 * 빈 대화 추천 요청(WP-139). screenContext — 화면 참고 칩이 켜져 있을 때만(웹 전송 규칙과 같음), 상한 검증은 AiScreenContext 재사용.
 */
public record AiSuggestionRequest(@Valid AiScreenContext screenContext) {}
