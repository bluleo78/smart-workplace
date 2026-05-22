package com.workplace.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** 멤버 역할 변경 요청. */
public record UpdateMemberRoleRequest(@NotBlank @Pattern(regexp = "OWNER|MEMBER") String role) {}
