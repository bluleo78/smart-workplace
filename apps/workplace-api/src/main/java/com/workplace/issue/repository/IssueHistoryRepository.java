package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.dto.IssueHistoryEntryResponse;
import com.workplace.issue.dto.IssueHistoryEventType;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** issue_history 리포지토리. 응답 시 USER 테이블과 JOIN 하여 actor 이름을 포함한다. */
@Repository
@RequiredArgsConstructor
public class IssueHistoryRepository {

  private final DSLContext dsl;

  /** SELECT 결과를 {@link IssueHistoryEntryResponse} 로 매핑. user.name/kind/username JOIN 포함. */
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
        created != null ? created.toInstant() : null,
        r.get(USER.USERNAME));
  }

  /** 이슈 단위 히스토리 목록 조회 (created_at asc). */
  public List<IssueHistoryEntryResponse> findByIssue(Long issueId) {
    return dsl.select(
            ISSUE_HISTORY.ID,
            ISSUE_HISTORY.ACTOR_ID,
            USER.NAME,
            USER.KIND,
            USER.USERNAME,
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

  /**
   * 이슈의 부모를 마지막으로 바꾼 사용자의 kind(HUMAN·AGENT) — 부모 변경 이력이 없으면 empty. created_at(트랜잭션 시작 시각)이 아니라 id 로
   * 정렬한다 — id 는 행 잠금 뒤 INSERT 때 매겨져 같은 이슈 안에서 커밋 순서와 같다.
   */
  public Optional<String> findLastParentChangerKind(Long issueId) {
    return dsl.select(USER.KIND)
        .from(ISSUE_HISTORY)
        .join(USER)
        .on(USER.ID.eq(ISSUE_HISTORY.ACTOR_ID))
        .where(
            ISSUE_HISTORY
                .ISSUE_ID
                .eq(issueId)
                .and(ISSUE_HISTORY.EVENT_TYPE.eq(IssueHistoryEventType.PARENT_CHANGED.name())))
        .orderBy(ISSUE_HISTORY.ID.desc())
        .limit(1)
        .fetchOptional(USER.KIND);
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
