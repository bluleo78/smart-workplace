package com.workplace.role.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 역할 생성 요청. WP-570: 설명 상한은 DB(role.description VARCHAR(255)) — 넘치면 영어 409 대신 한국어 400. */
public record CreateRoleRequest(
    @NotBlank
        @Size(max = 50, message = "역할 이름은 50자 이내여야 합니다")
        @Pattern(regexp = "[A-Z][A-Z0-9_]*", message = "역할 이름은 대문자, 숫자, 밑줄만 허용됩니다")
        String name,
    @Size(max = 255, message = "역할 설명은 255자까지 쓸 수 있습니다") String description) {}
