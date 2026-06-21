package com.workplace.platform.dto;

import jakarta.validation.constraints.PositiveOrZero;

/** 테넌트 드라이브 한도 변경 요청(#81). */
public record UpdateTenantQuotaRequest(@PositiveOrZero long quotaBytes) {}
