package com.workplace.issue.workflow.repository;

/**
 * 게시 버전의 정체만(WP-1985) — 실행 view 의 workflowId·versionNo 에 쓴다.
 *
 * @param id 버전 id
 * @param workflowId 속한 정의 id
 * @param versionNo 게시 번호
 */
public record WorkflowVersionRef(long id, long workflowId, int versionNo) {}
