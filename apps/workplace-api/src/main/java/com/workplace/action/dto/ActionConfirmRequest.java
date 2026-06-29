package com.workplace.action.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;

/** 공용 확인 요청 — actionType 으로 라우팅, params 는 actionType 별 스키마(서버에서 검증). */
public record ActionConfirmRequest(@NotBlank String actionType, JsonNode params) {}
