package com.workplace.platform.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * 운영자 콘솔 — 기존(전역) 사용자를 테넌트 멤버로 추가하는 요청. 계정을 새로 만들지 않고 membership + RBAC 역할만 부여한다.
 *
 * <p>{@code role} 은 멤버십 직위(OWNER/MEMBER) — {@link AddTenantMemberRequest} 와 동일한 규칙으로 RBAC
 * 역할(ADMIN/USER) 을 함께 부여받는다.
 */
public record AddExistingTenantMemberRequest(
    @NotNull Long userId,
    @NotBlank @Pattern(regexp = "OWNER|MEMBER", message = "역할은 OWNER 또는 MEMBER 여야 합니다")
        String role) {}
