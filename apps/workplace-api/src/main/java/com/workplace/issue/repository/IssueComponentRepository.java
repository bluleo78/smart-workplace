package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_COMPONENT;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * issue_component(이슈 ↔ 구성요소 M:N) 연결 쓰기·조회(WP-933). 요약(이름·보관 여부)이 필요한 읽기는 {@code
 * ComponentRepository.summariesByIssueIds} 가 맡고, 여기는 연결 행만 다룬다(issue_label 저장소와 같은 역할).
 */
@Repository
@RequiredArgsConstructor
public class IssueComponentRepository {

  private final DSLContext dsl;

  /** 연결 추가 — 이미 있으면 무시(같은 요청 재시도에도 안전). */
  public void add(long issueId, long componentId) {
    dsl.insertInto(ISSUE_COMPONENT)
        .set(ISSUE_COMPONENT.ISSUE_ID, issueId)
        .set(ISSUE_COMPONENT.COMPONENT_ID, componentId)
        .onConflictDoNothing()
        .execute();
  }

  /** 연결 제거. */
  public void remove(long issueId, long componentId) {
    dsl.deleteFrom(ISSUE_COMPONENT)
        .where(
            ISSUE_COMPONENT.ISSUE_ID.eq(issueId).and(ISSUE_COMPONENT.COMPONENT_ID.eq(componentId)))
        .execute();
  }
}
