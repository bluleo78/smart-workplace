package com.workplace.notify.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 구독 해제 요청 — 이 기기의 endpoint. */
public record PushSubscriptionDeleteRequest(@NotBlank @Size(max = 2048) String endpoint) {}
