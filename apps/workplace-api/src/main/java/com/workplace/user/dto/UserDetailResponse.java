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
    // Phase 5a — HUMAN | AGENT
    String kind,
    // AI 가용성 — 개인/공통 비서(active token) 중 하나라도 있으면 true. 프론트 AI affordance 게이트용.
    boolean aiAvailable) {}
