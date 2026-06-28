package com.workplace.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** ADMIN 이 AGENT 의 username(로그인 식별자)·name(표시 이름)을 변경할 때 입력. email 은 변경하지 않는다. */
// name 은 DB user.name VARCHAR(50) 과 맞춰 max=50 — 초과 입력은 DB 500 대신 400 으로 거른다.
public record RenameAgentRequest(
    @NotBlank @Size(max = 50) String username, @NotBlank @Size(max = 50) String name) {}
