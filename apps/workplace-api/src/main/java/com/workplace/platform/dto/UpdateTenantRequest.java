package com.workplace.platform.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 테넌트 기본 정보(이름·slug) 수정 요청(WP-336).
 *
 * <p>{@code slug} 를 비우면(null/공백) 생성과 같이 이름에서 자동 생성한다. 지정 시 ASCII 소문자·숫자·하이픈만 허용하고(slugify 규칙과 동일)
 * 다른 테넌트와 겹치면 400.
 */
public record UpdateTenantRequest(
    @NotBlank @Size(max = 255, message = "이름은 255자 이하로 입력하세요") String name,
    @Size(max = TenantSlugRule.MAX, message = TenantSlugRule.SIZE_MESSAGE)
        @Pattern(regexp = TenantSlugRule.REGEX, message = TenantSlugRule.MESSAGE)
        String slug) {}
