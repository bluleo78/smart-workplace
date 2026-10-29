package com.workplace.watcher.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_WATCHER;

import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** issue_watcher N:M jOOQ 리포지토리. */
@Repository
@RequiredArgsConstructor
public class IssueWatcherRepository {

  private final DSLContext dsl;

  /** 멱등 등록 — 중복 PK 는 무시. 신규 row 가 실제로 insert 된 경우 true, 이미 존재해서 no-op 인 경우 false. */
  public boolean add(Long issueId, Long userId) {
    int affected =
        dsl.insertInto(ISSUE_WATCHER)
            .set(ISSUE_WATCHER.ISSUE_ID, issueId)
            .set(ISSUE_WATCHER.USER_ID, userId)
            .onConflictDoNothing()
            .execute();
    return affected > 0;
  }

  /** 멱등 해제. */
  public void remove(Long issueId, Long userId) {
    dsl.deleteFrom(ISSUE_WATCHER)
        .where(ISSUE_WATCHER.ISSUE_ID.eq(issueId).and(ISSUE_WATCHER.USER_ID.eq(userId)))
        .execute();
  }

  /**
   * 한 프로젝트의 모든 이슈에서 이 사람들의 워처 등록을 한 문장으로 지운다 — 프로젝트에서 빠져 더 볼 수 없게 된 사람의 정리용(WP-476, 여러 명 WP-1129).
   */
  public int removeFromProject(long projectId, Collection<Long> userIds) {
    if (userIds.isEmpty()) return 0;
    return dsl.deleteFrom(ISSUE_WATCHER)
        .where(ISSUE_WATCHER.USER_ID.in(userIds))
        .and(
            ISSUE_WATCHER.ISSUE_ID.in(
                dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId))))
        .execute();
  }

  /** 이슈의 watcher 사용자 ID 목록. */
  public List<Long> findUserIdsByIssue(Long issueId) {
    return dsl.select(ISSUE_WATCHER.USER_ID)
        .from(ISSUE_WATCHER)
        .where(ISSUE_WATCHER.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_WATCHER.USER_ID);
  }

  /** 사용자가 구독 중인 이슈가 하나라도 있는지 — 빈 목록 판정에 id 를 모두 읽지 않도록 EXISTS 로 본다. */
  public boolean existsByUser(Long userId) {
    return dsl.fetchExists(ISSUE_WATCHER, ISSUE_WATCHER.USER_ID.eq(userId));
  }
}
