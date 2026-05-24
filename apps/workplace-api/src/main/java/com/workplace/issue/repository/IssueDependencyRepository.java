package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_DEPENDENCY;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;

import com.workplace.issue.dto.IssueLinkSummary;
import com.workplace.issue.dto.IssueTypeSummary;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.springframework.stereotype.Repository;

/**
 * issue_dependency 단방향 jOOQ 리포지토리. (issue_id, blocks_issue_id) row 는 "issue_id 가 blocks_issue_id 를
 * 차단" 을 의미. (Phase 4b)
 */
@Repository
@RequiredArgsConstructor
public class IssueDependencyRepository {

  private final DSLContext dsl;

  /** (issueId, blocksIssueId) row 추가 — PK 중복은 ON CONFLICT DO NOTHING 으로 멱등 처리. */
  public void add(Long issueId, Long blocksIssueId, Long createdBy) {
    dsl.insertInto(ISSUE_DEPENDENCY)
        .set(ISSUE_DEPENDENCY.ISSUE_ID, issueId)
        .set(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID, blocksIssueId)
        .set(ISSUE_DEPENDENCY.CREATED_BY, createdBy)
        .set(ISSUE_DEPENDENCY.CREATED_AT, OffsetDateTime.now())
        .onConflictDoNothing()
        .execute();
  }

  /** 멱등 가드용 — (issueId, blocksIssueId) row 존재 여부. */
  public boolean exists(Long issueId, Long blocksIssueId) {
    return dsl.fetchExists(
        ISSUE_DEPENDENCY,
        ISSUE_DEPENDENCY
            .ISSUE_ID
            .eq(issueId)
            .and(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID.eq(blocksIssueId)));
  }

  /** 호출 이슈가 차단하는 이슈 id 들 — 사이클 검출 DFS 에서 사용 (요약 join 없이 가벼운 fetch). */
  public List<Long> findBlocksOf(Long issueId) {
    return dsl.select(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID)
        .from(ISSUE_DEPENDENCY)
        .where(ISSUE_DEPENDENCY.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID);
  }

  /** (issueId, blocksIssueId) row 삭제 — 삭제 행 수 반환 (history 기록 게이트). */
  public int remove(Long issueId, Long blocksIssueId) {
    return dsl.deleteFrom(ISSUE_DEPENDENCY)
        .where(
            ISSUE_DEPENDENCY
                .ISSUE_ID
                .eq(issueId)
                .and(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID.eq(blocksIssueId)))
        .execute();
  }

  /**
   * N+1 회피 — issueIds[*] 가 어떤 이슈들에 의해 차단되는지 batch 조회. deleted 이슈는 제외. 결과 맵은 입력 id 모두에 대해 빈 리스트로 초기화
   * 후 채운다.
   */
  public Map<Long, List<IssueLinkSummary>> findBlockedByForIssues(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    Map<Long, List<IssueLinkSummary>> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, new ArrayList<>());
    dsl.select(
            ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.STATUS,
            ISSUE_TYPE_DEF.ID,
            ISSUE_TYPE_DEF.NAME,
            ISSUE_TYPE_DEF.COLOR_TOKEN,
            ISSUE_TYPE_DEF.ICON)
        .from(ISSUE_DEPENDENCY)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_DEPENDENCY.ISSUE_ID))
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID))
        .where(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID.in(issueIds).and(ISSUE.DELETED_AT.isNull()))
        .orderBy(ISSUE.NUMBER.asc())
        .fetch()
        .forEach(
            r ->
                result
                    .get(r.get(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID))
                    .add(
                        new IssueLinkSummary(
                            r.get(ISSUE.NUMBER),
                            r.get(ISSUE.TITLE),
                            r.get(ISSUE.STATUS),
                            new IssueTypeSummary(
                                r.get(ISSUE_TYPE_DEF.ID),
                                r.get(ISSUE_TYPE_DEF.NAME),
                                r.get(ISSUE_TYPE_DEF.COLOR_TOKEN),
                                r.get(ISSUE_TYPE_DEF.ICON)))));
    return result;
  }

  /** N+1 회피 — issueIds[*] 가 차단하는 이슈들 batch 조회. deleted 이슈는 제외. */
  public Map<Long, List<IssueLinkSummary>> findBlocksForIssues(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    Map<Long, List<IssueLinkSummary>> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, new ArrayList<>());
    dsl.select(
            ISSUE_DEPENDENCY.ISSUE_ID,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            ISSUE.STATUS,
            ISSUE_TYPE_DEF.ID,
            ISSUE_TYPE_DEF.NAME,
            ISSUE_TYPE_DEF.COLOR_TOKEN,
            ISSUE_TYPE_DEF.ICON)
        .from(ISSUE_DEPENDENCY)
        .join(ISSUE)
        .on(ISSUE.ID.eq(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID))
        .join(ISSUE_TYPE_DEF)
        .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID))
        .where(ISSUE_DEPENDENCY.ISSUE_ID.in(issueIds).and(ISSUE.DELETED_AT.isNull()))
        .orderBy(ISSUE.NUMBER.asc())
        .fetch()
        .forEach(
            r ->
                result
                    .get(r.get(ISSUE_DEPENDENCY.ISSUE_ID))
                    .add(
                        new IssueLinkSummary(
                            r.get(ISSUE.NUMBER),
                            r.get(ISSUE.TITLE),
                            r.get(ISSUE.STATUS),
                            new IssueTypeSummary(
                                r.get(ISSUE_TYPE_DEF.ID),
                                r.get(ISSUE_TYPE_DEF.NAME),
                                r.get(ISSUE_TYPE_DEF.COLOR_TOKEN),
                                r.get(ISSUE_TYPE_DEF.ICON)))));
    return result;
  }

  /**
   * N+1 회피 — issueIds[*] 의 blocked 플래그 batch. blockedBy 중 DONE/CANCELED 가 아닌 활성 이슈가 하나라도 있으면 true.
   * 입력 id 는 항상 결과 키로 들어가며, 미차단은 false.
   */
  public Map<Long, Boolean> findBlockedFlags(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    Map<Long, Boolean> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, false);
    var ids =
        dsl.selectDistinct(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID)
            .from(ISSUE_DEPENDENCY)
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_DEPENDENCY.ISSUE_ID))
            .where(
                ISSUE_DEPENDENCY
                    .BLOCKS_ISSUE_ID
                    .in(issueIds)
                    .and(ISSUE.DELETED_AT.isNull())
                    .and(ISSUE.STATUS.notIn("DONE", "CANCELED")))
            .fetch(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID);
    Set<Long> blocked = new HashSet<>(ids);
    for (Long id : issueIds) {
      if (blocked.contains(id)) result.put(id, true);
    }
    return result;
  }
}
