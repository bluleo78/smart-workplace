package com.workplace.home.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

/** 홈 채팅 요청 본문. sessionId null 이면 서비스가 새 세션 생성. query 는 필수. screenContext 는 선택(WP-54 현재 화면). */
public record HomeChatRequest(
    UUID sessionId, @NotBlank String query, @Valid AiScreenContext screenContext) {}
