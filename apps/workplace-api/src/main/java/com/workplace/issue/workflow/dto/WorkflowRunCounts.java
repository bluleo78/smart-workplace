package com.workplace.issue.workflow.dto;

import java.util.Map;

/**
 * 정의의 노드별 진행 중 실행 수(WP-1991, {@code GET /workflows/{id}/run-counts}).
 *
 * <p>WP-2157: 실행 탭 「진행 중 n · 완료 n · 전체」 합계용 {@code byStatus} 를 더했다.
 *
 * @param counts 노드 키 → 활성(RUNNING·WAITING·SUSPENDED) 실행 수. 0 인 노드는 담지 않는다
 * @param byStatus 실행 상태 → 실행 수(전 버전, 삭제된 이슈 제외). 다섯 상태 키를 0 포함해 모두 담는다
 */
public record WorkflowRunCounts(Map<String, Integer> counts, Map<String, Integer> byStatus) {}
