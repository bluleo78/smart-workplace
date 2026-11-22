package com.workplace.issue.workflow.dto;

import java.time.Instant;

/**
 * 게시 버전 목록 한 줄(원문·모델 없음).
 *
 * @param activeRuns 이 버전으로 돌고 있는 실행 수(실행 표가 생기기 전까지 0)
 */
public record WorkflowVersionSummary(
    int versionNo, Instant createdAt, WorkflowActor createdBy, int activeRuns) {}
