package com.workplace.chat.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/** 읽음 표시 요청. uptoMessageId 까지 읽었다고 갱신. */
public record MarkChatReadRequest(@NotNull @Positive Long uptoMessageId) {}
