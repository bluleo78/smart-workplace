package com.workplace.issue.workflow.repository;

import java.time.Instant;

/**
 * 워크플로우 게시 버전 한 행(workflow_version). 게시한 뒤에는 고치지 않는다.
 *
 * @param versionNo 정의마다 1부터 하나씩 늘어나는 게시 번호
 * @param modelJson 해석한 모델 JSON(Task 1 의 {@code WorkflowModelJson.write} 글 — DB 가 공백 등을 정리해 돌려줄 수
 *     있다)
 * @param createdBy 게시한 사용자(탈퇴했으면 null)
 */
public record WorkflowVersionRow(
    long id,
    long workflowId,
    int versionNo,
    String sourceYaml,
    String modelJson,
    Long createdBy,
    Instant createdAt) {}
