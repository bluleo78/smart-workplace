package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_HISTORY;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.dto.IssueHistoryEntryResponse;
import java.time.OffsetDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.jooq.impl.DSL;
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
   * 이력 한 건 INSERT — createdAt 이 있으면 그 시각(가져오기가 원본 이력을 보존할 때, WP-883), null 이면 DB 기본값(지금). INSERT
   * 구현은 이 한 곳뿐이다.
   */
  public void insert(
      Long issueId,
      Long actorId,
      String eventType,
      String fromValue,
      String toValue,
      OffsetDateTime createdAt) {
    var insert =
        dsl.insertInto(ISSUE_HISTORY)
            .set(ISSUE_HISTORY.ISSUE_ID, issueId)
            .set(ISSUE_HISTORY.ACTOR_ID, actorId)
            .set(ISSUE_HISTORY.EVENT_TYPE, eventType)
            .set(ISSUE_HISTORY.FROM_VALUE, fromValue)
            .set(ISSUE_HISTORY.TO_VALUE, toValue);
    if (createdAt != null) {
      insert = insert.set(ISSUE_HISTORY.CREATED_AT, createdAt);
    }
    insert.execute();
  }

  /** 히스토리 한 건 INSERT(시각은 DB 기본값) — 일반 변경 기록용 편의 오버로드. */
  public void insert(
      Long issueId, Long actorId, String eventType, String fromValue, String toValue) {
    insert(issueId, actorId, eventType, fromValue, toValue, null);
  }

  /**
   * 같은 이벤트를 여러 이슈에 한 문장으로 남긴다 — 상태 삭제로 옮긴 이슈 전부의 STATUS_MIGRATED(WP-809). id 목록을 배열 하나로 묶어 {@code
   * INSERT … SELECT … FROM issue WHERE id = ANY(?)} 로 넣는다 — 행마다 값을 바인딩하면 이슈가 많을 때 PostgreSQL 바인드
   * 상한(65535)을 넘는다. 빈 입력은 아무것도 하지 않는다.
   */
  public void insertBatch(
      List<Long> issueIds, Long actorId, String eventType, String fromValue, String toValue) {
    if (issueIds == null || issueIds.isEmpty()) return;
    dsl.insertInto(
            ISSUE_HISTORY,
            ISSUE_HISTORY.ISSUE_ID,
            ISSUE_HISTORY.ACTOR_ID,
            ISSUE_HISTORY.EVENT_TYPE,
            ISSUE_HISTORY.FROM_VALUE,
            ISSUE_HISTORY.TO_VALUE)
        .select(
            dsl.select(
                    ISSUE.ID,
                    DSL.val(actorId, ISSUE_HISTORY.ACTOR_ID),
                    DSL.val(eventType, ISSUE_HISTORY.EVENT_TYPE),
                    DSL.val(fromValue, ISSUE_HISTORY.FROM_VALUE),
                    DSL.val(toValue, ISSUE_HISTORY.TO_VALUE))
                .from(ISSUE)
                .where(ISSUE.ID.eq(DSL.any(issueIds.toArray(Long[]::new)))))
        .execute();
  }

  /**
   * 이슈마다 값이 다른 같은 이벤트 여러 줄을 한 문장으로 남긴다 — 여러 사람이 담당에서 한꺼번에 빠질 때의 담당자 변경 이력(WP-1129). 이슈 id·값을 배열 둘로
   * 묶어 {@code unnest} 로 펼친다(행마다 바인딩하면 PostgreSQL 바인드 상한을 넘을 수 있다). 두 목록은 같은 길이이고, 그 순서로 들어간다.
   */
  public void insertRows(
      List<Long> issueIds, List<String> toValues, Long actorId, String eventType) {
    // 두 배열 길이가 다르면 unnest 가 짧은 쪽을 NULL 로 채워 값 없는 이력이 남는다 — 부른 쪽 실수로 막는다.
    if (issueIds.size() != toValues.size())
      throw new IllegalArgumentException("issueIds 와 toValues 의 길이가 다르다");
    if (issueIds.isEmpty()) return;
    var rows =
        DSL.table(
            "unnest({0}::bigint[], {1}::text[]) with ordinality as hr(issue_id, to_value, ord)",
            DSL.val(issueIds.toArray(Long[]::new)), DSL.val(toValues.toArray(String[]::new)));
    dsl.insertInto(
            ISSUE_HISTORY,
            ISSUE_HISTORY.ISSUE_ID,
            ISSUE_HISTORY.ACTOR_ID,
            ISSUE_HISTORY.EVENT_TYPE,
            ISSUE_HISTORY.FROM_VALUE,
            ISSUE_HISTORY.TO_VALUE)
        .select(
            dsl.select(
                    DSL.field("hr.issue_id", Long.class),
                    DSL.val(actorId, ISSUE_HISTORY.ACTOR_ID),
                    DSL.val(eventType, ISSUE_HISTORY.EVENT_TYPE),
                    DSL.inline((String) null, ISSUE_HISTORY.FROM_VALUE),
                    DSL.field("hr.to_value", String.class))
                .from(rows)
                .orderBy(DSL.field("hr.ord")))
        .execute();
  }
}
