package com.workplace.issue.workflow.dto;

import java.util.List;

/** 저장 없는 검증의 응답. */
public record WorkflowValidationResult(List<WorkflowProblem> problems) {}
