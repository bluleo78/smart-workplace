package com.workplace.issue.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;

/** 이슈 생성 요청. priority 기본값(MID)은 서비스에서 적용. assigneeIds 는 다중 담당자 (선택). */
public record CreateIssueRequest(
    @NotBlank @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    LocalDate dueDate,
    List<Long> assigneeIds) {}
