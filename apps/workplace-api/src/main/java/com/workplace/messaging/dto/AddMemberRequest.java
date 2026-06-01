package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotNull;

/** 채널 멤버 추가 요청. */
public record AddMemberRequest(@NotNull Long userId) {}
