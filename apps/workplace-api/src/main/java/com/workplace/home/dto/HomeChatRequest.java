package com.workplace.home.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

/** 홈 채팅 요청 본문. sessionId null 이면 서비스가 새 세션 생성. query 는 필수. */
public record HomeChatRequest(UUID sessionId, @NotBlank String query) {}
