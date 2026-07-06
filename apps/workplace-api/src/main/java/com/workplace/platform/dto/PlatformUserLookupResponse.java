package com.workplace.platform.dto;

/** 운영자 콘솔 — 이메일로 조회한 전역 사용자 정보. 기존 사용자를 다른 테넌트 멤버로 추가하는 흐름의 사전 확인에 쓰인다. */
public record PlatformUserLookupResponse(
    Long userId, String name, String email, boolean isPlatformAdmin) {}
