package com.workplace.issue.dto;

/**
 * 관리자용 관계 유형 응답 — 기본 필드에 유형별 사용 건수(내부 관계·외부 링크)를 더한다. 차단({@code BLOCKS})의 {@code relationCount} 는
 * 의존성 건수다.
 */
public record IssueRelationTypeAdminResponse(
    long id,
    String code,
    String name,
    boolean directed,
    String outwardLabel,
    String inwardLabel,
    boolean externalOnly,
    boolean hidden,
    int sortOrder,
    long relationCount,
    long externalLinkCount) {

  public static IssueRelationTypeAdminResponse from(
      IssueRelationTypeRow r, long relationCount, long externalLinkCount) {
    return new IssueRelationTypeAdminResponse(
        r.id(),
        r.code(),
        r.name(),
        r.directed(),
        r.outwardLabel(),
        r.inwardLabel(),
        r.externalOnly(),
        r.hidden(),
        r.sortOrder(),
        relationCount,
        externalLinkCount);
  }
}
