package com.workplace.issue.dto;

/**
 * 이슈 상세의 관계 한 줄(WP-887) — 「이 이슈는 {label} · {issue}」. 차단(의존성)은 여기 오지 않고 {@code
 * summary.blockedBy/blocks} 로 온다. 상대 이슈를 읽을 수 없거나 상대가 삭제됐으면 줄 자체가 빠진다.
 *
 * @param id 관계 id — 지우기 경로({@code DELETE …/relations/{id}})가 쓴다
 * @param typeId 관계 유형 id
 * @param typeCode 기본 유형 코드(사용자 정의 유형이면 null)
 * @param label 이 이슈 쪽 말(방향 있는 유형은 이 이슈가 A 쪽이면 A 쪽 말, B 쪽이면 B 쪽 말)
 * @param side 이 이슈가 A 쪽이면 {@code source}, B 쪽이면 {@code target} — 방향 없는 유형은 늘 {@code source}. 화면이 말로
 *     쪽을 짐작하지 않게 싣는다
 * @param issue 상대 이슈 요약
 */
public record IssueRelationView(
    long id, long typeId, String typeCode, String label, String side, RelatedIssue issue) {

  /**
   * 관계의 상대 이슈 요약 — 다른 프로젝트일 수 있어 프로젝트 키를 함께 싣는다.
   *
   * @param status 상태 범주(TODO/IN_PROGRESS/DONE/CANCELED) — 의존성 요약({@link IssueLinkSummary})과 같은 값
   */
  public record RelatedIssue(
      String projectKey, int number, String title, String status, IssueTypeSummary type) {}
}
