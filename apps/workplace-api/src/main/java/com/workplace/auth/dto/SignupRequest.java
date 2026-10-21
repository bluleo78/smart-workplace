package com.workplace.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record SignupRequest(
    @NotBlank @Email String username,
    @Email String email,
    @NotBlank
        @Size(min = 8, max = 128)
        @Pattern(
            regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$",
            message = "비밀번호에는 영문 대문자·소문자와 숫자가 하나 이상씩 들어가야 합니다")
        String password,
    // user.name 은 VARCHAR(50) — 넘으면 409 대신 400 필드 오류로 알린다(WP-670).
    @NotBlank @Size(max = 50, message = "이름은 50자 이하로 입력하세요") String name) {}
