package com.workplace.auth.dto;

import jakarta.validation.constraints.NotNull;

/** 2단계: 활성 테넌트 선택 요청. */
public record SelectTenantRequest(@NotNull Long tenantId) {}
