package com.workplace.agentruntime.dto;

import jakarta.validation.constraints.NotNull;

/** 「새 작업 받기」 변경 요청(WP-1514) — 값 누락은 400. */
public record PutAcceptNewWorkRequest(@NotNull Boolean acceptNewWork) {}
