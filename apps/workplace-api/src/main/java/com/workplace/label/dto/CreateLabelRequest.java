package com.workplace.label.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 라벨 생성/수정 공통 요청 본문. 두 시나리오 모두 name + colorToken 필수. */
public record CreateLabelRequest(
    @NotBlank @Size(max = 40) String name, @NotBlank String colorToken) {}
