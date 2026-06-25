package com.workplace.platform.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 운영자 콘솔 — 테넌트에 멤버(소유자/일반)를 추가하는 요청. 공개 가입이 닫힌 모델에서 신규 사용자 계정은 이 경로로 생성된다(#497).
 *
 * <p>{@code role} 은 멤버십 직위(OWNER/MEMBER). OWNER 는 RBAC ADMIN, MEMBER 는 RBAC USER 역할을 함께 부여받는다(두 축
 * 분리). {@code username} 은 별도로 받지 않고 {@code email} 을 로그인 아이디로 사용한다. 비밀번호 규칙은 셀프 가입(SignupRequest)과
 * 동일.
 */
public record AddTenantMemberRequest(
    @NotBlank @Email String email,
    @NotBlank String name,
    @NotBlank
        @Size(min = 8, max = 128)
        @Pattern(
            regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$",
            message = "비밀번호는 영문 대문자·소문자·숫자를 각각 1자 이상 포함해야 합니다")
        String password,
    @NotBlank @Pattern(regexp = "OWNER|MEMBER", message = "역할은 OWNER 또는 MEMBER 여야 합니다")
        String role) {}
