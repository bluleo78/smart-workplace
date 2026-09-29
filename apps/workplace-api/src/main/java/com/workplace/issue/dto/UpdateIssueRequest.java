package com.workplace.issue.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;

/**
 * 이슈 부분 수정 요청. null 필드는 변경 없음을 의미. clearDueDate 플래그로 명시적 NULL 설정을 지원한다. version 을 주면 그 사이 다른 편집이
 * 있었을 때 409(#611). 담당자는 별도 PUT 엔드포인트로 관리하므로 본 record 에서 제거되었다.
 */
public record UpdateIssueRequest(
    @Size(max = 200) String title,
    @Size(max = 10000) String body,
    @Pattern(regexp = "TODO|IN_PROGRESS|DONE|CANCELED") String status,
    @Pattern(regexp = "LOW|MID|HIGH") String priority,
    LocalDate dueDate,
    Boolean clearDueDate,
    LocalDate startDate,
    Boolean clearStartDate,
    Long milestoneId,
    Boolean clearMilestone,
    // #611 낙관적 동시성 — 클라이언트가 마지막으로 읽은 이슈 version. null 이면 검사하지 않는다(보드 드래그·일괄 변경·AI 도구 등).
    Integer version) {}
