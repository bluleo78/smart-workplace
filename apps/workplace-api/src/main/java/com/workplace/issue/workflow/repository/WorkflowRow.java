package com.workplace.issue.workflow.repository;

import java.time.Instant;

/**
 * 워크플로우 정의 한 행(workflow). 초안({@code draftYaml})은 저장할 때마다 덮어쓰고, 게시한 것은 {@link WorkflowVersionRow} 로
 * 쌓는다.
 *
 * @param activeVersionId 지금 쓰는 게시 버전(게시한 적 없거나 그 버전이 지워졌으면 null)
 * @param draftUpdatedBy 초안을 마지막으로 저장한 사용자(탈퇴했으면 null)
 */
public record WorkflowRow(
    long id,
    long projectId,
    String name,
    boolean enabled,
    Long activeVersionId,
    String draftYaml,
    Long draftUpdatedBy,
    Instant draftUpdatedAt,
    Instant createdAt) {}
