package com.workplace.home.dto;

import java.time.Instant;
import java.util.UUID;

/** 세션 단건(생성 응답 등). */
public record HomeSessionResponse(
    UUID id, String title, Instant createdAt, Instant lastMessageAt) {}
