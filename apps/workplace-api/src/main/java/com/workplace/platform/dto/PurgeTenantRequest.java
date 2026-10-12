package com.workplace.platform.dto;

import jakarta.validation.constraints.NotNull;

/** 영구 삭제 요청 — 운영자가 입력한 테넌트 이름(오조작 방지 확인용). */
public record PurgeTenantRequest(@NotNull String confirmName) {}
