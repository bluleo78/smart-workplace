package com.workplace.issue.service;

/**
 * 이슈 키 상태 일괄 조회(WP-2102) 결과 한 건 — 키와 상태 이름·범주만. 본문에서 이슈 키 링크를 완료·취소 표시(취소선 등)로 그리는 데 쓴다.
 *
 * @param issueKey 프로젝트키-번호 (예: WP-12)
 * @param statusName 프로젝트 상태 이름
 * @param statusCategory 상태 범주(TODO·IN_PROGRESS·DONE·CANCELED)
 */
public record IssueKeyStatus(String issueKey, String statusName, String statusCategory) {}
