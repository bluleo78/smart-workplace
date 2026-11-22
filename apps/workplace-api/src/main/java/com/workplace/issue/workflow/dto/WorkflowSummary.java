package com.workplace.issue.workflow.dto;

/**
 * 워크플로우 목록 한 줄(원문·모델 없음).
 *
 * @param activeVersionNo 게시한 적 없으면 null
 * @param draftChanged 활성 버전이 없거나 초안이 활성 원문과 다름
 */
public record WorkflowSummary(
    long id, String name, boolean enabled, Integer activeVersionNo, boolean draftChanged) {}
