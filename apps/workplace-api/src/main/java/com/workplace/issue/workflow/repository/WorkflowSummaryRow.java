package com.workplace.issue.workflow.repository;

/**
 * 정의 목록의 요약 행. 원문을 DB 에서 나르지 않는다 — 개수 상한이 없어 목록 한 번이 공유 API 힙을 넘길 수 있다.
 *
 * @param activeVersionNo 활성 버전의 번호(없으면 null)
 * @param draftChanged 활성 버전이 없거나 초안이 활성 원문과 다름(DB 가 계산)
 */
public record WorkflowSummaryRow(
    long id, String name, boolean enabled, Integer activeVersionNo, boolean draftChanged) {}
