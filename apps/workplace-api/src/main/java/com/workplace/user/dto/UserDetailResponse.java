package com.workplace.user.dto;

import com.workplace.role.dto.RoleResponse;
import java.time.LocalDateTime;
import java.util.List;

public record UserDetailResponse(
    Long id,
    String username,
    String email,
    String name,
    boolean isActive,
    LocalDateTime createdAt,
    List<RoleResponse> roles,
    // Phase 5a — HUMAN | AGENT (마지막 위치 추가)
    String kind) {}
