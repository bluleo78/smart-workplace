package com.workplace.issue.dto;

/**
 * 관계 유형 한 행(서비스 내부·다른 서비스용). 기본 유형만 {@code code} 가 있다.
 *
 * @param outwardLabel A(source) 쪽 말 — 「이 이슈는 ___」의 서술어
 * @param inwardLabel B(target) 쪽 말(방향 없으면 null)
 */
public record IssueRelationTypeRow(
    long id,
    String code,
    String name,
    boolean directed,
    String outwardLabel,
    String inwardLabel,
    boolean externalOnly,
    boolean hidden,
    int sortOrder) {

  /**
   * 이 이슈 쪽에서 보이는 말. 방향 없는 유형은 늘 {@code outwardLabel}, 방향 있는 유형은 이 이슈가 A 쪽이면 outward · B 쪽이면 inward.
   *
   * @param isSource 이 이슈가 A(source) 쪽인가
   */
  public String labelFor(boolean isSource) {
    return !directed || isSource ? outwardLabel : inwardLabel;
  }
}
