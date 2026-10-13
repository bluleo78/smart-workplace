package com.workplace.home.dto;

import java.util.List;

/** 빈 대화 추천 응답(WP-139). enabled=false 면 사용자가 추천을 껐다 — 웹이 캐시해 이후 호출하지 않는다. */
public record AiSuggestionResponse(List<String> items, boolean enabled) {}
