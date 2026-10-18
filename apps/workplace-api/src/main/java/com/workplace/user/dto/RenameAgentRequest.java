package com.workplace.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * ADMIN 이 AGENT 의 username(로그인 식별자)·name(표시 이름)·description(설명(역할), WP-455)을 변경할 때 입력. email 은 변경하지
 * 않는다. description 은 빈 문자열이면 지우고, 빠지면(null) 그대로 둔다.
 *
 * <p>길이 상한은 DB(user.name VARCHAR(50), user.description VARCHAR(500))와 맞춰 초과 입력을 DB 500 대신 400 으로
 * 거른다.
 */
public record RenameAgentRequest(
    @NotBlank @Size(max = 50) String username,
    @NotBlank @Size(max = 50) String name,
    @Size(max = 500) String description) {}
