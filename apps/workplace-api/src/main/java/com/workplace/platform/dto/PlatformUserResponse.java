package com.workplace.platform.dto;

import java.util.List;

/** 운영자 본인 정보 응답 — 식별 정보 + 보유 플랫폼 권한코드(운영자 콘솔 UI 표시용). */
public record PlatformUserResponse(
    Long id, String username, String name, String email, List<String> permissions) {}
