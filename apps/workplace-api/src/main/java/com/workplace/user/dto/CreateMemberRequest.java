package com.workplace.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 테넌트 관리자가 새 구성원(계정)을 추가할 때의 요청.
 *
 * <p>아이디(username)=로그인 ID(고유, ≤50자). 이메일은 연락용 선택값(비우면 null). 역할은 관리자=ADMIN, 일반=USER.
 */
public record CreateMemberRequest(
    @NotBlank @Size(max = 50, message = "아이디는 50자 이하여야 합니다") String username,
    @Email(message = "올바른 이메일 형식이 아닙니다") String email,
    @NotBlank @Size(max = 50, message = "이름은 50자 이하여야 합니다") String name,
    @NotBlank
        @Size(min = 8, max = 128)
        @Pattern(
            regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$",
            message = "비밀번호는 영문 대문자·소문자·숫자를 각각 1자 이상 포함해야 합니다")
        String password,
    @NotBlank @Pattern(regexp = "ADMIN|USER", message = "역할은 ADMIN 또는 USER 여야 합니다") String role) {}
