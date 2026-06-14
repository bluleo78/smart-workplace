package com.workplace.platform.dto;

/** 운영자 콘솔 — 테넌트 멤버 항목. role 은 멤버십의 name-based 역할(OWNER/ADMIN/MEMBER). */
public record TenantMemberResponse(
    Long userId, String username, String name, String email, String role, String status) {}
