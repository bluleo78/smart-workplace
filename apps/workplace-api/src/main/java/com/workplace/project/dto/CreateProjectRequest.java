package com.workplace.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/** 프로젝트 생성 요청. key 는 대문자/숫자 2~10자, 첫 글자는 대문자. */
public record CreateProjectRequest(
    @NotBlank
        @Pattern(regexp = "^[A-Z][A-Z0-9]{1,9}$", message = "key 는 대문자/숫자 2~10자, 첫 글자는 대문자여야 합니다")
        String key,
    @NotBlank @Size(max = 120) String name,
    @Size(max = 2000) String description) {}
