package com.workplace.chat.repository;

import static com.workplace.jooq.Tables.CHAT_THREAD;

import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/** chat_thread 리포지토리. issue_id UNIQUE 로 1:1. */
@Repository
@RequiredArgsConstructor
public class ChatThreadRepository {

  private final DSLContext dsl;

  /** issue_id 로 thread id 조회. */
  public Optional<Long> findIdByIssueId(long issueId) {
    return dsl.select(CHAT_THREAD.ID)
        .from(CHAT_THREAD)
        .where(CHAT_THREAD.ISSUE_ID.eq(issueId))
        .fetchOptional(r -> r.get(CHAT_THREAD.ID));
  }

  /** issue_id 로 thread row 조회 (archived_at 포함). */
  public Optional<ThreadRow> findByIssueId(long issueId) {
    return dsl.select(CHAT_THREAD.ID, CHAT_THREAD.ARCHIVED_AT)
        .from(CHAT_THREAD)
        .where(CHAT_THREAD.ISSUE_ID.eq(issueId))
        .fetchOptional(
            r -> new ThreadRow(r.get(CHAT_THREAD.ID), toInstant(r.get(CHAT_THREAD.ARCHIVED_AT))));
  }

  /**
   * 동시 호출 race 안전한 INSERT. ON CONFLICT (issue_id) DO NOTHING 후 SELECT 로 반환. 신규 생성/이미 존재 모두 id 를
   * 돌려준다.
   */
  public long insertIfAbsent(long issueId) {
    dsl.execute(
        "INSERT INTO chat_thread (issue_id) VALUES (?) ON CONFLICT (issue_id) DO NOTHING", issueId);
    return findIdByIssueId(issueId)
        .orElseThrow(() -> new IllegalStateException("insertIfAbsent failed"));
  }

  private static java.time.Instant toInstant(OffsetDateTime odt) {
    return odt == null ? null : odt.toInstant();
  }

  public record ThreadRow(long id, java.time.Instant archivedAt) {}
}
