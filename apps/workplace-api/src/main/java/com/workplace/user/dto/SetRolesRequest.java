package com.workplace.user.dto;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

/** 사용자 역할 할당 요청 DTO. roleIds 는 null 및 빈 리스트 모두 거부 — 사용자에게 역할이 최소 1개 이상 있어야 한다. */
public record SetRolesRequest(
    @NotNull @NotEmpty(message = "역할은 최소 1개 이상 선택해야 합니다.") List<Long> roleIds) {}
