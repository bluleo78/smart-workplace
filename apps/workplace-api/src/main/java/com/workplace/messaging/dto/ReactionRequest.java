package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 리액션 추가 요청. emoji 1~32자(유니코드 문자열). */
public record ReactionRequest(@NotBlank @Size(min = 1, max = 32) String emoji) {}
