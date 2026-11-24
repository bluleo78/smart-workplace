package com.workplace.issue.workflow.dto;

import java.util.Map;

/**
 * 정의의 노드별 진행 중 실행 수(WP-1991, {@code GET /workflows/{id}/run-counts}).
 *
 * @param counts 노드 키 → 활성(RUNNING·WAITING·SUSPENDED) 실행 수. 0 인 노드는 담지 않는다
 */
public record WorkflowRunCounts(Map<String, Integer> counts) {}
