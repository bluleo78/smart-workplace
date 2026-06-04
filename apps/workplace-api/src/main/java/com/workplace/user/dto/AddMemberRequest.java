package com.workplace.user.dto;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 멤버 편입 요청. MEMBER→user.id, EXTERNAL→contact_entry.id (서비스에서 존재·가독 검증). */
public record AddMemberRequest(
    @NotNull @Pattern(regexp = "MEMBER|EXTERNAL") String targetType, @NotNull Long targetId) {}
