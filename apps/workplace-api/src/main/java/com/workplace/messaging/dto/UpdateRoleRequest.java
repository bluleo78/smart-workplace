package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotNull;

/** 멤버 역할 변경 요청. role: OWNER|ADMIN|MEMBER (값 검증은 서비스에서). */
public record UpdateRoleRequest(@NotNull String role) {}
