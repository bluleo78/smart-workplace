package com.workplace.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/** 멤버 추가 요청. */
public record AddMemberRequest(
    @NotNull Long userId, @NotBlank @Pattern(regexp = "OWNER|MEMBER") String role) {}
