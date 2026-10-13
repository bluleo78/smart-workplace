package com.workplace.user.dto;

import jakarta.validation.constraints.NotNull;

/** 사용자 AI 사용 설정 저장(WP-139). 값 누락은 400 — 실수로 끄거나 켜지 않게 boolean 이 아닌 Boolean+NotNull. */
public record UpdateAiPreferencesRequest(@NotNull Boolean suggestionsEnabled) {}
