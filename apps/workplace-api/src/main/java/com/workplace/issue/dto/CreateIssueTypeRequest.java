package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 유형 생성/수정 본문. PATCH 도 동일 record 사용. */
public record CreateIssueTypeRequest(
    @NotBlank @Size(max = 40) String name, @NotBlank String colorToken, @NotBlank String icon) {}
