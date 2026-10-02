package com.workplace.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 테넌트 관리자가 새 구성원(계정)을 추가할 때의 요청.
 *
 * <p>아이디(username)=로그인 ID(고유, ≤50자). WP-181: 첫 SSO 로그인 매칭 키라 로그인 방식과 무관하게 회사 계정 주소(이메일)여야 한다(@Email
 * 은 점 없는 도메인도 허용해 더 엄격한 정규식 사용). AGENT 는 CreateAgentRequest 를 쓰므로 대상이 아니다. 이메일은 연락용 선택값(비우면 null).
 * 역할은 관리자=ADMIN, 일반=USER.
 */
public record CreateMemberRequest(
    @NotBlank
        @Size(max = 50, message = "아이디는 50자 이하여야 합니다")
        @Pattern(regexp = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", message = "아이디는 이메일 형식이어야 합니다")
        String username,
    @Email(message = "올바른 이메일 형식이 아닙니다") String email,
    @NotBlank @Size(max = 50, message = "이름은 50자 이하여야 합니다") String name,
    // WP-48: 비우면(null) SSO 전용 구성원 — 서비스가 워크스페이스 SSO 켜짐을 검증한다.
    @Size(min = 8, max = 128)
        @Pattern(
            regexp = "^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).+$",
            message = "비밀번호는 영문 대문자·소문자·숫자를 각각 1자 이상 포함해야 합니다")
        String password,
    @NotBlank @Pattern(regexp = "ADMIN|USER", message = "역할은 ADMIN 또는 USER 여야 합니다") String role) {}
