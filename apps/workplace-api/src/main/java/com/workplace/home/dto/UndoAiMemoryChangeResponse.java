package com.workplace.home.dto;

/** 기록 되돌리기 결과(WP-385) — 되돌림 표시가 붙은 기록. */
public record UndoAiMemoryChangeResponse(AiMemoryChangeItem change) {}
