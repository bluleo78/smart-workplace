package com.workplace.calendar.dto;

import jakarta.validation.constraints.NotNull;

/** 일정에 노트를 잇는 요청(WP-1701). */
public record LinkEventNoteRequest(@NotNull(message = "노트를 선택하세요") Long pageId) {}
