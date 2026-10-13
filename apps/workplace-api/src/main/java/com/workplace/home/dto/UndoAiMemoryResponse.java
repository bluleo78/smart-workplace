package com.workplace.home.dto;

import com.fasterxml.jackson.annotation.JsonInclude;

/** 되돌리기 결과(WP-55). memory = 복원(updated)·재생성(forgotten)된 항목 — saved 되돌리기와 이미 되돌린 줄의 재호출(멱등)이면 없음. */
public record UndoAiMemoryResponse(
    long messageId,
    int blockIndex,
    boolean undone,
    @JsonInclude(JsonInclude.Include.NON_NULL) AiMemoryItem memory) {}
