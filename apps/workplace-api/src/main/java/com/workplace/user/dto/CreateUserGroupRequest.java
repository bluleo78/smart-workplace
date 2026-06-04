package com.workplace.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 그룹 생성 요청. SHARED 는 user-group:manage 권한 필요(서비스에서 검증), PERSONAL 은 owner=caller. */
public record CreateUserGroupRequest(
    @NotBlank @Size(max = 100) String name,
    Long parentId,
    @NotNull @Pattern(regexp = "SHARED|PERSONAL") String visibility,
    @Size(max = 64) String code,
    Integer sortOrder) {}
