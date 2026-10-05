package com.workplace.issue.dto;

/**
 * 자식 이슈 응답에 포함되는 부모 이슈 요약 (번호/제목/유형/상태).
 *
 * <p>status 는 부모 이슈의 현재 상태(IssueResponse.status 와 같은 문자열). 검색 필터로 부모(에픽) 행이 응답에서 빠져도 하위 이슈만으로 부모가
 * 취소됐는지 알 수 있게 실어 보낸다(WP-247 — 타임라인이 취소 에픽의 하위를 「에픽 없음」으로 옮기는 근거). 이력 payload 에는 저장하지 않는다
 * (IssueHistoryRecorder 는 number/title 만 기록).
 */
public record ParentRef(int number, String title, IssueTypeSummary type, String status) {}
