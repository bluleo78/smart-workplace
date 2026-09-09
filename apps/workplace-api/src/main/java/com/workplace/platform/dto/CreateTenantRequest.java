package com.workplace.platform.dto;

import jakarta.validation.constraints.NotBlank;

/**
 * 운영자 콘솔 — 테넌트 생성 요청.
 *
 * <p>{@code slug} 는 선택(nullable)이며, 지정 시 전역 유일해야 한다. 비우면(null/공백) 서버가 이름을 slugify 해 자동 생성하고 중복 시
 * "-2", "-3" … suffix 로 유일하게 만든다(#695). {@code ownerUserId} 도 선택(nullable)이다 — 지정하면 해당 기존 사용자를 초기
 * 소유자(OWNER 멤버십 + ADMIN 역할)로 등록하고, 비우면 소유자 없는 빈 테넌트를 만든다(소유자는 이후 멤버 화면에서 추가, #496/#497).
 */
public record CreateTenantRequest(@NotBlank String name, String slug, Long ownerUserId) {}
