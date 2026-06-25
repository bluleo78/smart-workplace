package com.workplace.platform.dto;

/**
 * 운영자 콘솔 — 테넌트 멤버 항목. role 은 멤버십의 name-based 역할(OWNER/ADMIN/MEMBER).
 *
 * <p>{@code isPlatformOperator} 는 해당 계정이 플랫폼 운영자(platform_user_role 보유)인지 — 멤버 목록의 신원 마스킹 예외(원본 노출)
 * 판정에 쓰인다.
 */
public record TenantMemberResponse(
    Long userId,
    String username,
    String name,
    String email,
    String role,
    String status,
    boolean isPlatformOperator) {}
