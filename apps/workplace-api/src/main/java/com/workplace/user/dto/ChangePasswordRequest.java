package com.workplace.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record ChangePasswordRequest(
    // WP-48: 비밀번호가 없는(SSO 전용) 계정의 최초 설정은 현재 비밀번호 없이 허용 — 서비스가 분기한다.
    String currentPassword,
    @NotBlank
        @Size(min = 8, max = 128)
        @Pattern(
            regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$",
            message = "비밀번호는 영문 대문자, 소문자, 숫자를 각각 하나 이상 포함해야 합니다")
        String newPassword) {}
