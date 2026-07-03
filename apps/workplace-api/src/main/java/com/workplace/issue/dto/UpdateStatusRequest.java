package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** PATCH /status 요청 — DnD 전용. status 는 UpdateIssueRequest 와 동일한 enum 값만 허용(400 으로 조기 차단). */
public record UpdateStatusRequest(
    @NotBlank @Pattern(regexp = "TODO|IN_PROGRESS|DONE|CANCELED") String status) {}
