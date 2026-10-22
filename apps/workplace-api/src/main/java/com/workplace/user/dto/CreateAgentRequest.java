package com.workplace.user.dto;

import com.workplace.global.util.AccountIdentifierRules;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** ADMIN 이 AGENT 유저를 생성할 때 입력. 비밀번호 없음 — AGENT 는 로그인 불가. */
public record CreateAgentRequest(
    @NotBlank
        @Size(max = 50)
        @Pattern(
            regexp = AccountIdentifierRules.ASCII_ONLY,
            message = AccountIdentifierRules.ASCII_ONLY_MESSAGE)
        String username,
    // user.name 은 VARCHAR(50) — 100 이면 51~100자가 409 「Data integrity violation」으로 났다(WP-670). 이름
    // 변경(RenameAgentRequest)과 같은 50.
    @NotBlank @Size(max = 50, message = "이름은 50자 이하로 입력하세요") String name,
    @NotBlank
        @Email
        @Pattern(
            regexp = AccountIdentifierRules.ASCII_ONLY,
            message = AccountIdentifierRules.ASCII_ONLY_MESSAGE)
        String email) {}
