package com.workplace.platform.dto;

/**
 * 운영자 콘솔 — 이메일로 조회한 전역 사용자 정보. 기존 사용자를 테넌트 멤버로 추가하거나 테넌트 소유자로 지정하기 전의 확인에 쓰인다.
 *
 * @param ownerEligible 테넌트 소유자로 지정할 수 있는지(활성 HUMAN) — 콘솔이 확인 단계에서 바로 막기 위함(WP-337)
 */
public record PlatformUserLookupResponse(
    Long userId, String name, String email, boolean isPlatformAdmin, boolean ownerEligible) {}
