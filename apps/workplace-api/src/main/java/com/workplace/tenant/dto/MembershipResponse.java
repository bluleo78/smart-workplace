package com.workplace.tenant.dto;

/** 사용자의 한 테넌트 소속(테넌트 선택 화면용). */
public record MembershipResponse(Long tenantId, String tenantName, String tenantSlug) {}
