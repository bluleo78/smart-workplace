package com.workplace.platform.dto;

/** 운영자 본인(/me) 정보 — 운영자 평면에서 필요한 최소 필드만 노출. */
public record PlatformUserResponse(Long id, String username, String name, String email) {}
