package com.workplace.chat.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

/** 수동 멤버 추가 요청. */
public record AddChatMemberRequest(@NotNull @Positive Long userId) {}
