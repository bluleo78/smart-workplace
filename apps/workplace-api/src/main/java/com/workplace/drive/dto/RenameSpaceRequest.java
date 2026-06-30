package com.workplace.drive.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 공간 이름 변경 요청 — CreateSpaceRequest 와 동일 검증 규칙. */
public record RenameSpaceRequest(@NotBlank @Size(max = 255) String name) {}
