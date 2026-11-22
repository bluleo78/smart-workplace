package com.workplace.issue.workflow.repository;

import java.time.Instant;

/**
 * 게시 버전 요약 행(버전 목록·상세의 활성 버전). 원문·모델은 크고 쌓이기만 하므로 요약에는 나르지 않는다.
 *
 * @param createdBy 게시한 사용자(탈퇴했으면 null)
 */
public record WorkflowVersionSummaryRow(
    long id, int versionNo, Instant createdAt, Long createdBy) {}
