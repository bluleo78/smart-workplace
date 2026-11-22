package com.workplace.issue.workflow.dto;

import java.time.Instant;
import java.util.List;

/** 초안 저장 응답 — 저장된 시각과 그 초안의 문제(오류가 있어도 저장은 된다). */
public record SaveDraftResult(Instant draftUpdatedAt, List<WorkflowProblem> problems) {}
