package com.workplace.home.dto;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;

/** 확인 카드 승인 본문. actionType 으로 도메인 실행기를 라우팅하고 params 는 액션별 동적 페이로드. */
public record HomeActionConfirmRequest(@NotBlank String actionType, JsonNode params) {}
