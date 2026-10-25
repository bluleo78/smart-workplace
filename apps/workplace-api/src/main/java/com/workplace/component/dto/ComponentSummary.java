package com.workplace.component.dto;

/**
 * 이슈에 붙은 구성요소 요약(WP-933) — IssueResponse·이력 payload 에 임베드된다. archived 는 보관된 구성요소가 붙은 이슈 상세를 읽기 전용으로
 * 그리는 데 쓴다.
 */
public record ComponentSummary(long id, String name, boolean archived) {}
