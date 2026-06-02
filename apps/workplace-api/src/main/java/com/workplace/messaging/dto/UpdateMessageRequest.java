package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 메시지 수정 요청. body 제약은 작성과 동일(1–4000). */
public record UpdateMessageRequest(@NotBlank @Size(max = 4000) String body) {}
