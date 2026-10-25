package com.workplace.issue.dto;

/**
 * 이미 유형을 해석하고 주소를 정규화한 외부 링크 한 줄 — 가져오기가 {@code IssueExternalLinkService.insertForImport} 로 넘긴다.
 *
 * @param typeId 관계 유형 id
 * @param issueIsSource 방향 있는 유형에서 이 이슈가 A 쪽인가(방향 없는 유형은 서비스가 true 로 맞춘다)
 * @param url 정규화된 http/https 주소
 * @param key 상대 시스템의 키(없으면 null)
 * @param title 제목
 */
public record ResolvedExternalLink(
    long typeId, boolean issueIsSource, String url, String key, String title) {}
