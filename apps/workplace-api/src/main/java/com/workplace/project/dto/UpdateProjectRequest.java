package com.workplace.project.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** 프로젝트 수정 요청. key 는 불변. */
public record UpdateProjectRequest(
    @NotBlank @Size(max = 120) String name, @Size(max = 2000) String description) {}
