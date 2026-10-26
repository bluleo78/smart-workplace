package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_VERSION;

import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * issue_version(이슈 ↔ 버전, 종류 FIX|AFFECTS) 연결 쓰기(WP-888). 요약(이름·상태)이 필요한 읽기는 {@code
 * VersionRepository.summariesByIssueIdsBothKinds} 가 맡고, 여기는 연결 행만 다룬다({@link
 * IssueComponentRepository} 와 같은 역할).
 */
@Repository
@RequiredArgsConstructor
public class IssueVersionRepository {

  private final DSLContext dsl;

  /** 연결 추가 — 이미 있으면 무시(같은 요청 재시도에도 안전). */
  public void add(long issueId, long versionId, String kind) {
    dsl.insertInto(ISSUE_VERSION)
        .set(ISSUE_VERSION.ISSUE_ID, issueId)
        .set(ISSUE_VERSION.VERSION_ID, versionId)
        .set(ISSUE_VERSION.KIND, kind)
        .onConflictDoNothing()
        .execute();
  }

  /** 연결 제거(해당 종류만). */
  public void remove(long issueId, long versionId, String kind) {
    dsl.deleteFrom(ISSUE_VERSION)
        .where(
            ISSUE_VERSION
                .ISSUE_ID
                .eq(issueId)
                .and(ISSUE_VERSION.VERSION_ID.eq(versionId))
                .and(ISSUE_VERSION.KIND.eq(kind)))
        .execute();
  }
}
