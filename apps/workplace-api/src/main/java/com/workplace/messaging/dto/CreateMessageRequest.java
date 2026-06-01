package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 메시지 작성 요청. body 1~4000 자. */
public record CreateMessageRequest(@NotBlank @Size(min = 1, max = 4000) String body) {}
