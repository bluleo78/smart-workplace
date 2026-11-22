package com.workplace.issue.workflow.dto;

import java.util.List;
import java.util.Map;

/**
 * 워크플로우 오류 본문 — 전역 {@link com.workplace.global.dto.ErrorResponse} 와 같은 최상위 필드에 {@code problems} 만
 * 더한다. 전역 본문은 문제 목록을 실을 자리가 없고, 넓히면 모든 API 의 계약이 바뀐다.
 *
 * @param problems 422 {@code WORKFLOW_INVALID} 에만 들어 있고 다른 코드는 빈 목록
 */
public record WorkflowErrorResponse(
    int status,
    String error,
    String message,
    Map<String, String> errors,
    String timestamp,
    String path,
    List<WorkflowProblem> problems) {}
