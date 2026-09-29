package com.workplace.auth.sso.dto;

/** WP-48 워크스페이스 SSO 설정 조회 응답. available=운영자 env 설정 여부. */
public record SsoSettingsResponse(
    boolean available, boolean enabled, String adminConsentUrl, long passwordlessMemberCount) {}
