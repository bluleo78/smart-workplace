package com.workplace.user.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import java.time.LocalDateTime;

public record UserResponse(
    Long id,
    String username,
    String email,
    String name,
    boolean isActive,
    @JsonFormat(pattern = "yyyy-MM-dd'T'HH:mm:ss") LocalDateTime createdAt,
    // Phase 5a — HUMAN | AGENT (마지막 위치 추가, 호출자 모두 갱신)
    String kind) {}
