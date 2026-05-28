package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.dto.IssueHistoryEntryResponse;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** issue_history 리포지토리. 응답 시 USER 테이블과 JOIN 하여 actor 이름을 포함한다. */
@Repository
@RequiredArgsConstructor
public class IssueHistoryRepository {

  private final DSLContext dsl;

  /** SELECT 결과를 {@link IssueHistoryEntryResponse} 로 매핑. user.name/kind JOIN 포함. */
  private IssueHistoryEntryResponse mapToResponse(Record r) {
    OffsetDateTime created = r.get(ISSUE_HISTORY.CREATED_AT);
    return new IssueHistoryEntryResponse(
        r.get(ISSUE_HISTORY.ID),
        r.get(ISSUE_HISTORY.ACTOR_ID),
        r.get(USER.NAME),
        r.get(USER.KIND),
        r.get(ISSUE_HISTORY.EVENT_TYPE),
        r.get(ISSUE_HISTORY.FROM_VALUE),
        r.get(ISSUE_HISTORY.TO_VALUE),
        created != null ? created.toInstant() : null);
  }

  /** 이슈 단위 히스토리 목록 조회 (created_at asc). */
  public List<IssueHistoryEntryResponse> findByIssue(Long issueId) {
    return dsl.select(
            ISSUE_HISTORY.ID,
            ISSUE_HISTORY.ACTOR_ID,
            USER.NAME,
            USER.KIND,
            ISSUE_HISTORY.EVENT_TYPE,
            ISSUE_HISTORY.FROM_VALUE,
            ISSUE_HISTORY.TO_VALUE,
            ISSUE_HISTORY.CREATED_AT)
        .from(ISSUE_HISTORY)
        .join(USER)
        .on(USER.ID.eq(ISSUE_HISTORY.ACTOR_ID))
        .where(ISSUE_HISTORY.ISSUE_ID.eq(issueId))
        .orderBy(ISSUE_HISTORY.CREATED_AT.asc())
        .fetch(this::mapToResponse);
  }

  /** 히스토리 한 건 INSERT. */
  public void insert(
      Long issueId, Long actorId, String eventType, String fromValue, String toValue) {
    dsl.insertInto(ISSUE_HISTORY)
        .set(ISSUE_HISTORY.ISSUE_ID, issueId)
        .set(ISSUE_HISTORY.ACTOR_ID, actorId)
        .set(ISSUE_HISTORY.EVENT_TYPE, eventType)
        .set(ISSUE_HISTORY.FROM_VALUE, fromValue)
        .set(ISSUE_HISTORY.TO_VALUE, toValue)
        .execute();
  }
}
