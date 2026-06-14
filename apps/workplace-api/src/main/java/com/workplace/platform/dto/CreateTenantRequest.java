package com.workplace.platform.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 운영자 콘솔 — 테넌트 생성 요청.
 *
 * <p>{@code slug} 는 선택(nullable)이며, 지정 시 전역 유일해야 한다. {@code ownerUserId} 는 신규 테넌트의 초기 소유자(OWNER
 * 멤버십)로 등록될 기존 사용자의 id 다.
 */
public record CreateTenantRequest(@NotBlank String name, String slug, @NotNull Long ownerUserId) {}
