package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/** 이슈 생성 요청. priority 기본값(MID)은 서비스에서 적용. */
public record CreateIssueRequest(
    @NotBlank @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    LocalDate dueDate,
    Long assigneeId) {}
