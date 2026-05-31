package com.workplace.home.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.UUID;

/** compose 요청 본문. sessionId null 이면 서비스가 새 세션 생성. query 는 필수. */
public record HomeComposeRequest(UUID sessionId, @NotBlank String query) {}
