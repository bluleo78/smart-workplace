package com.workplace.issue.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;

/**
 * 자식 이슈 응답에 포함되는 부모 이슈 요약 (번호/제목/유형/상태).
 *
 * <p>status 는 부모 이슈의 현재 상태(IssueResponse.status 와 같은 문자열). 검색 필터로 부모(에픽) 행이 응답에서 빠져도 하위 이슈만으로 부모가
 * 취소됐는지 알 수 있게 실어 보낸다(WP-247 — 타임라인이 취소 에픽의 하위를 「에픽 없음」으로 옮기는 근거). 이력 payload 에는 저장하지 않는다
 * (IssueHistoryRecorder 는 number/title/projectKey 만 기록).
 *
 * <p>{@code statusId}·{@code statusName}·{@code statusColor} 는 부모의 프로젝트 사용자 정의 상태(WP-869). 범주
 * 코드만으로는 「검토 중」 같은 이름을 보여 줄 수 없어 함께 싣는다. 이력 JSON 에 필드가 늘어도 웹 파서는 모르는 필드를 무시한다.
 *
 * <p>WP-1038: 일반 이슈의 부모(에픽)는 다른 프로젝트에 있을 수 있어 {@code projectKey} 로 부모 키를 만든다. 조회자가 부모 프로젝트를 읽을 수
 * 없으면 {@link #hiddenRef()} — 번호 0·나머지 null·{@code hidden=true} — 로 바꿔 부모가 있다는 사실만 알린다. {@code
 * projectId} 는 그 가림 판정에 쓰는 내부 값이라 응답에 싣지 않는다.
 */
public record ParentRef(
    int number,
    String title,
    IssueTypeSummary type,
    String status,
    Long statusId,
    String statusName,
    String statusColor,
    String projectKey,
    boolean hidden,
    @JsonIgnore Long projectId) {

  /** 조회자가 읽을 수 없는 프로젝트의 부모 — 존재만 알리고 번호·제목·키 등은 싣지 않는다(WP-1038). */
  public static ParentRef hiddenRef() {
    return new ParentRef(0, null, null, null, null, null, null, null, true, null);
  }
}
