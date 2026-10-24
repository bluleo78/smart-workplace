package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_DEPENDENCY;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;

import com.workplace.issue.dto.IssueLinkSummary;
import com.workplace.issue.dto.IssueStatuses;
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

  /**
   * 의존성 추가 직렬화 잠금 classId — 2-인자 pg_advisory_xact_lock(classId, projectId)(WP-758). 이슈 번호를 쓰는 관례지만
   * 758 은 노트 트리 잠금이 이미 써서 7580 을 쓴다.
   */
  private static final int DEPENDENCY_LOCK_CLASS = 7580;

  /**
   * 이 프로젝트의 의존성 추가를 트랜잭션 끝까지 직렬화한다(자동 해제, WP-758). 순환 검사(DFS)와 관계 저장 사이에 다른 추가가 끼면, 두 요청이 서로 커밋 전의
   * 그래프를 보고 둘 다 통과해 순환이 저장됐다. 의존성은 같은 프로젝트 안에서만 맺으므로 프로젝트 단위로 잠근다.
   */
  public void lockProjectDependencies(long projectId) {
    // 2-int 잠금 키라 project id 를 int 로 접는다 — 21억을 넘는 id 가 다른 프로젝트와 겹쳐도 직렬화가 넓어질 뿐 정합성은 같다.
    dsl.execute("SELECT pg_advisory_xact_lock(?, ?)", DEPENDENCY_LOCK_CLASS, (int) projectId);
  }

  /** 타임라인 화살표용 — 프로젝트 전체의 이슈 의존 엣지(이슈번호 쌍)를 전부 반환. 삭제된 이슈가 낀 엣지는 제외. */
  public record DependencyEdge(int fromIssueNumber, int toIssueNumber) {}

  /** 프로젝트 소속 이슈 간 (차단, 피차단) 엣지를 이슈번호 쌍으로 전부 조회. from 이 to 를 차단(issue_id → blocks_issue_id). */
  public List<DependencyEdge> listEdgesByProject(Long projectId) {
    var from = ISSUE.as("dep_from");
    var to = ISSUE.as("dep_to");
    return dsl.select(from.NUMBER, to.NUMBER)
        .from(ISSUE_DEPENDENCY)
        .join(from)
        .on(from.ID.eq(ISSUE_DEPENDENCY.ISSUE_ID))
        .join(to)
        .on(to.ID.eq(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID))
        .where(
            from.PROJECT_ID
                .eq(projectId)
                .and(to.PROJECT_ID.eq(projectId))
                .and(from.DELETED_AT.isNull())
                .and(to.DELETED_AT.isNull()))
        .fetch(r -> new DependencyEdge(r.value1(), r.value2()));
  }

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
            IssueStatusProjection.withFields(
                ISSUE,
                ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID,
                ISSUE.NUMBER,
                ISSUE.TITLE,
                ISSUE.STATUS,
                ISSUE.DUE_DATE,
                ISSUE_TYPE_DEF.ID,
                ISSUE_TYPE_DEF.NAME,
                ISSUE_TYPE_DEF.COLOR_TOKEN,
                ISSUE_TYPE_DEF.ICON))
        // 사용자 정의 상태 이름·색(WP-869) — 공용 LEFT JOIN(WP-937)
        .from(
            IssueStatusProjection.leftJoin(
                ISSUE_DEPENDENCY
                    .join(ISSUE)
                    .on(ISSUE.ID.eq(ISSUE_DEPENDENCY.ISSUE_ID))
                    .join(ISSUE_TYPE_DEF)
                    .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID)),
                ISSUE))
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
                                r.get(ISSUE_TYPE_DEF.ICON)),
                            r.get(ISSUE.DUE_DATE),
                            r.get(ISSUE.STATUS_ID),
                            r.get(IssueStatusProjection.STATUS_NAME),
                            r.get(IssueStatusProjection.STATUS_COLOR))));
    return result;
  }

  /** N+1 회피 — issueIds[*] 가 차단하는 이슈들 batch 조회. deleted 이슈는 제외. */
  public Map<Long, List<IssueLinkSummary>> findBlocksForIssues(List<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    Map<Long, List<IssueLinkSummary>> result = new HashMap<>();
    for (Long id : issueIds) result.put(id, new ArrayList<>());
    dsl.select(
            IssueStatusProjection.withFields(
                ISSUE,
                ISSUE_DEPENDENCY.ISSUE_ID,
                ISSUE.NUMBER,
                ISSUE.TITLE,
                ISSUE.STATUS,
                ISSUE.DUE_DATE,
                ISSUE_TYPE_DEF.ID,
                ISSUE_TYPE_DEF.NAME,
                ISSUE_TYPE_DEF.COLOR_TOKEN,
                ISSUE_TYPE_DEF.ICON))
        // 사용자 정의 상태 이름·색(WP-869) — 공용 LEFT JOIN(WP-937)
        .from(
            IssueStatusProjection.leftJoin(
                ISSUE_DEPENDENCY
                    .join(ISSUE)
                    .on(ISSUE.ID.eq(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID))
                    .join(ISSUE_TYPE_DEF)
                    .on(ISSUE_TYPE_DEF.ID.eq(ISSUE.TYPE_ID)),
                ISSUE))
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
                                r.get(ISSUE_TYPE_DEF.ICON)),
                            r.get(ISSUE.DUE_DATE),
                            r.get(ISSUE.STATUS_ID),
                            r.get(IssueStatusProjection.STATUS_NAME),
                            r.get(IssueStatusProjection.STATUS_COLOR))));
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
    // 대상 이슈(target) 자신이 이미 DONE/CANCELED 면, 차단자가 미완료여도 blocked=false 로
    // 취급해야 하므로 target 을 별도 alias 로 조인해 상태를 함께 검사한다 (#826).
    var target = ISSUE.as("target");
    var ids =
        dsl.selectDistinct(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID)
            .from(ISSUE_DEPENDENCY)
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_DEPENDENCY.ISSUE_ID))
            .join(target)
            .on(target.ID.eq(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID))
            .where(
                ISSUE_DEPENDENCY
                    .BLOCKS_ISSUE_ID
                    .in(issueIds)
                    .and(ISSUE.DELETED_AT.isNull())
                    .and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED))
                    .and(target.STATUS.notIn(IssueStatuses.CLOSED)))
            .fetch(ISSUE_DEPENDENCY.BLOCKS_ISSUE_ID);
    Set<Long> blocked = new HashSet<>(ids);
    for (Long id : issueIds) {
      if (blocked.contains(id)) result.put(id, true);
    }
    return result;
  }
}
