package com.workplace.chat.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 메시지 수정 요청. */
public record UpdateChatMessageRequest(@NotBlank @Size(min = 1, max = 4000) String body) {}
