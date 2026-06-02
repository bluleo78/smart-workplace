package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.CYCLE;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_CYCLE;

import com.workplace.cycle.dto.CycleSummary;
import com.workplace.issue.dto.CycleProgress;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/** issue ↔ cycle N:M jOOQ 리포지토리 + 사이클 진행 집계 (issue 도메인 소유). */
@Repository
@RequiredArgsConstructor
public class IssueCycleRepository {

  private final DSLContext dsl;

  /** 이슈에 연결된 사이클 ID 집합. */
  public List<Long> findCycleIdsByIssue(Long issueId) {
    return dsl.select(ISSUE_CYCLE.CYCLE_ID)
        .from(ISSUE_CYCLE)
        .where(ISSUE_CYCLE.ISSUE_ID.eq(issueId))
        .fetch(ISSUE_CYCLE.CYCLE_ID);
  }

  /** 이슈에 연결된 사이클 요약 (name/status 조인). */
  public List<CycleSummary> findCyclesByIssue(Long issueId) {
    return dsl.select(CYCLE.ID, CYCLE.NAME, CYCLE.STATUS)
        .from(ISSUE_CYCLE)
        .join(CYCLE)
        .on(CYCLE.ID.eq(ISSUE_CYCLE.CYCLE_ID))
        .where(ISSUE_CYCLE.ISSUE_ID.eq(issueId))
        .orderBy(CYCLE.START_DATE.desc().nullsLast(), CYCLE.NAME.asc())
        .fetch(r -> new CycleSummary(r.get(CYCLE.ID), r.get(CYCLE.NAME), r.get(CYCLE.STATUS)));
  }

  /** 사이클 1건 연결 — 중복은 무시. */
  public void add(Long issueId, Long cycleId) {
    dsl.insertInto(ISSUE_CYCLE)
        .set(ISSUE_CYCLE.ISSUE_ID, issueId)
        .set(ISSUE_CYCLE.CYCLE_ID, cycleId)
        .onConflictDoNothing()
        .execute();
  }

  /** 사이클 1건 연결 해제. */
  public void remove(Long issueId, Long cycleId) {
    dsl.deleteFrom(ISSUE_CYCLE)
        .where(ISSUE_CYCLE.ISSUE_ID.eq(issueId).and(ISSUE_CYCLE.CYCLE_ID.eq(cycleId)))
        .execute();
  }

  /**
   * 프로젝트의 모든 사이클 진행 집계. issue_cycle ⨝ issue (비삭제) 를 (cycle_id, status) 로 그룹핑한다. 이슈가 N개 사이클에 걸치면 N개
   * 모두에 카운트(Jira 멀티-스프린트). 이슈 0건 사이클도 0 으로 포함.
   */
  public List<CycleProgress> progressByProject(Long projectId) {
    // 1) 프로젝트의 모든 사이클 id (이슈 0건도 결과에 포함하기 위해 선조회)
    List<Long> cycleIds =
        dsl.select(CYCLE.ID).from(CYCLE).where(CYCLE.PROJECT_ID.eq(projectId)).fetch(CYCLE.ID);

    // 2) (cycle_id, status) 별 카운트
    Map<Long, Map<String, Integer>> byCycle = new LinkedHashMap<>();
    for (Long id : cycleIds) byCycle.put(id, new LinkedHashMap<>());

    var rows =
        dsl.select(ISSUE_CYCLE.CYCLE_ID, ISSUE.STATUS, DSL.count())
            .from(ISSUE_CYCLE)
            .join(ISSUE)
            .on(ISSUE.ID.eq(ISSUE_CYCLE.ISSUE_ID))
            .where(ISSUE.PROJECT_ID.eq(projectId))
            .and(ISSUE.DELETED_AT.isNull())
            .groupBy(ISSUE_CYCLE.CYCLE_ID, ISSUE.STATUS)
            .fetch();
    for (var r : rows) {
      byCycle
          .computeIfAbsent(r.get(ISSUE_CYCLE.CYCLE_ID), k -> new LinkedHashMap<>())
          .put(r.get(ISSUE.STATUS), r.get(DSL.count()));
    }

    List<CycleProgress> result = new ArrayList<>();
    for (Long id : cycleIds) {
      Map<String, Integer> byStatus = byCycle.getOrDefault(id, Map.of());
      int total = byStatus.values().stream().mapToInt(Integer::intValue).sum();
      int done = byStatus.getOrDefault("DONE", 0);
      result.add(new CycleProgress(id, total, done, byStatus));
    }
    return result;
  }
}
