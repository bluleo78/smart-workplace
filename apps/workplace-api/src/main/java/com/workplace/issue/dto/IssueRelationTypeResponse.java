package com.workplace.issue.dto;

/** 관계 유형 목록 응답 — 로그인한 누구나 보는 형태(숨김 여부·코드·말 포함). */
public record IssueRelationTypeResponse(
    long id,
    String code,
    String name,
    boolean directed,
    String outwardLabel,
    String inwardLabel,
    boolean externalOnly,
    boolean hidden,
    int sortOrder) {

  public static IssueRelationTypeResponse from(IssueRelationTypeRow r) {
    return new IssueRelationTypeResponse(
        r.id(),
        r.code(),
        r.name(),
        r.directed(),
        r.outwardLabel(),
        r.inwardLabel(),
        r.externalOnly(),
        r.hidden(),
        r.sortOrder());
  }
}
