package com.workplace.issue.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * 이슈 부분 수정 요청. null 필드는 변경 없음을 의미. clearAssignee / clearDueDate 플래그로 명시적 NULL 설정을 지원한다 (PATCH 시
 * 'null 로 비우기' vs '변경 없음' 구분 용도).
 */
public record UpdateIssueRequest(
    @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "TODO|IN_PROGRESS|DONE|CANCELED") String status,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    LocalDate dueDate,
    Long assigneeId,
    Boolean clearAssignee,
    Boolean clearDueDate) {}
