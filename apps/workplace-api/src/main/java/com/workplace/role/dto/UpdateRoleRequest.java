package com.workplace.role.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 역할 수정 요청. WP-570: 이름 규칙(대문자·숫자·밑줄)을 생성({@link CreateRoleRequest})과 같게 적용하고, 설명은 DB 상한(255자)에서
 * 한국어로 막는다 — 전에는 수정으로 규칙 밖 이름이 저장되고 긴 설명은 영어 409 로 샜다.
 */
public record UpdateRoleRequest(
    @NotBlank
        @Size(max = 50, message = "역할 이름은 50자 이내여야 합니다")
        @Pattern(regexp = "[A-Z][A-Z0-9_]*", message = "역할 이름은 대문자, 숫자, 밑줄만 허용됩니다")
        String name,
    @Size(max = 255, message = "역할 설명은 255자까지 쓸 수 있습니다") String description) {}
