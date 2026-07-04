package com.workplace.milestone.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** 마일스톤 생성/수정 공통 요청 본문. name/dueDate 는 생성·수정 모두 필수, description 은 선택. */
public record CreateMilestoneRequest(
    @NotBlank @Size(max = 100) String name,
    @NotNull LocalDate dueDate,
    @Size(max = 2000) String description) {}
