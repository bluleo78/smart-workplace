package com.workplace.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 그룹 수정 요청. visibility 는 변경 불가(생성 시 고정). parentId 변경 시 사이클 방지 검증. */
public record UpdateUserGroupRequest(
    @NotBlank @Size(max = 100) String name,
    Long parentId,
    @Size(max = 64) String code,
    Integer sortOrder) {}
