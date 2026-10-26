package com.workplace.version.dto;

/**
 * 버전에 붙은 (삭제되지 않은) 이슈 수(WP-888) — 삭제 확인창·출시 대화상자의 안내용. fix = 수정 버전 이슈, affects = 영향 버전 이슈,
 * unresolvedFix = 수정 버전 이슈 중 끝나지 않은(완료·취소 아님) 것.
 */
public record VersionIssueCount(int fix, int affects, int unresolvedFix) {}
