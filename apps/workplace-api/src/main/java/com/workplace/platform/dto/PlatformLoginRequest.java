package com.workplace.platform.dto;

import jakarta.validation.constraints.NotBlank;

/** 운영자 로그인 요청. */
public record PlatformLoginRequest(@NotBlank String username, @NotBlank String password) {}
