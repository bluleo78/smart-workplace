package com.workplace.messaging.dto;

import jakarta.validation.constraints.NotNull;

/** 채널 멤버 부서 추가 요청(WP-1058) — 멤버로 둘 조직도 부서(user_group, SHARED) id. */
public record AddMemberGroupRequest(@NotNull Long groupId) {}
