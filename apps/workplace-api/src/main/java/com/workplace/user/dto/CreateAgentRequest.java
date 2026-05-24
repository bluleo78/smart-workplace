package com.workplace.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** ADMIN 이 AGENT 유저를 생성할 때 입력. 비밀번호 없음 — AGENT 는 로그인 불가. */
public record CreateAgentRequest(
    @NotBlank @Size(max = 50) String username,
    @NotBlank @Size(max = 100) String name,
    @NotBlank @Email String email) {}
