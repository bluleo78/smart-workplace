package com.workplace.issue.dto;

/**
 * 관계 대상 찾기({@code GET /api/v1/issues/lookup}) 결과 한 건(WP-887) — 호출자가 읽을 수 있는 프로젝트의 활성 이슈.
 *
 * @param status 상태 범주(TODO/IN_PROGRESS/DONE/CANCELED)
 */
public record IssueLookupItem(
    String projectKey, int number, String title, String status, IssueTypeSummary type) {}
