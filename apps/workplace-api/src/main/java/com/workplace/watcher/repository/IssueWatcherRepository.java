package com.workplace.watcher.repository;

import static com.workplace.jooq.Tables.ISSUE_WATCHER;

import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** issue_watcher N:M jOOQ 리포지토리. */
@Repository
@RequiredArgsConstructor
public class IssueWatcherRepository {

  private final DSLContext dsl;

  /** 멱등 등록 — 중복 PK 는 무시. */
  public void add(Long issueId, Long userId) {
    dsl.insertInto(ISSUE_WATCHER)
        .set(ISSUE_WATCHER.ISSUE_ID, issueId)
        .set(ISSUE_WATCHER.USER_ID, userId)
        .onConflictDoNothing()
        .execute();
  }

  /** 멱등 해제. */
  public void remove(Long issueId, Long userId) {
    dsl.deleteFrom(ISSUE_WATCHER)
        .where(ISSUE_WATCHER.ISSUE_ID.eq(issueId).and(ISSUE_WATCHER.USER_ID.eq(userId)))
        .execute();
  }

  /** 이슈의 watcher 사용자 ID 목록. */
  public List<Long> findUserIdsByIssue(Long issueId) {
    return dsl.select(ISSUE_WATCHER.USER_ID)
        .from(ISSUE_WATCHER)
        .where(ISSUE_WATCHER.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_WATCHER.USER_ID);
  }

  /** 사용자가 watch 하는 이슈 ID 목록. */
  public List<Long> findIssueIdsByUser(Long userId) {
    return dsl.select(ISSUE_WATCHER.ISSUE_ID)
        .from(ISSUE_WATCHER)
        .where(ISSUE_WATCHER.USER_ID.eq(userId))
        .fetch(ISSUE_WATCHER.ISSUE_ID);
  }
}
