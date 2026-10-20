package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 리액션 추가 요청. emoji 1~32자(유니코드 문자열) — 이모지 하나인지는 ReactionService 가 판정한다(WP-594). */
public record ReactionRequest(@NotBlank @Size(min = 1, max = 32) String emoji) {}
