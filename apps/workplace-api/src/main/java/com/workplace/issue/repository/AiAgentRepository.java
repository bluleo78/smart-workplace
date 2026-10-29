package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.PROJECT;
import static com.workplace.jooq.Tables.USER;

import com.workplace.issue.domain.IssueKeys;
import com.workplace.jooq.tables.AgentWork;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 위임 작업 「AI별」 보기(WP-1201) 조회 — AI 들의 열린 작업 행, 마지막 작업 종료 시각(AI 목록은
 * UserRepository#findActiveAgents). 판정(대표 상태·자리 수)은 서비스가 한다. 작업 행은 볼 수 없는 프로젝트 것도 함께 읽고(자리 수에 세야
 * 한다) 볼 수 있는지를 열로 싣는다.
 */
@Repository
@RequiredArgsConstructor
public class AiAgentRepository {

  private final DSLContext dsl;

  /**
   * 열린 작업 행 한 건.
   *
   * @param visible 호출자가 이 이슈를 볼 수 있는가(멤버인 프로젝트 등 — /me/issues 와 같은 범위)
   * @param mine 호출자가 이 이슈의 보고자·담당자인가(「나와 관련」)
   */
  public record WorkRow(
      long workerId,
      long issueId,
      Long parentIssueId,
      String projectKey,
      int number,
      String title,
      String state,
      String note,
      Instant updatedAt,
      Instant stateChangedAt,
      boolean stale,
      boolean visible,
      boolean mine) {

    /** 이슈 키(예: WP-12). */
    public String issueKey() {
      return IssueKeys.format(projectKey, number);
    }
  }

  /**
   * 작업자들의 열린 작업 행 — 살아 있는 작업({@link AgentWorkRepository#liveWork()})이고 이슈·프로젝트가 지워지지 않은 것.
   * visibleScope 는 호출자의 이슈 접근 범위(IssueRepository#memberScopeCondition)를 받는다.
   */
  public List<WorkRow> findLiveWorks(
      Collection<Long> workerIds, Condition visibleScope, long callerId) {
    if (workerIds.isEmpty()) return List.of();
    Field<Boolean> stale = DSL.field(AgentWorkRepository.stale()).as("is_stale");
    // 진행 중 행은 V238 백필·기본값으로 늘 값이 있다 — 없을 때만 마지막 보고 시각으로 본다.
    Field<OffsetDateTime> stateChangedAt =
        DSL.coalesce(AGENT_WORK.STATE_CHANGED_AT, AGENT_WORK.UPDATED_AT).as("state_since");
    Field<Boolean> visible = DSL.field(visibleScope).as("is_visible");
    // 「나와 관련」은 AI 위임 작업 목록과 같은 이슈 단위 기준(보고자·담당자).
    Field<Boolean> mine = DSL.field(AiTaskRepository.issueMine(callerId)).as("is_mine");
    return dsl.select(
            AGENT_WORK.WORKER_ID,
            ISSUE.ID,
            ISSUE.PARENT_ISSUE_ID,
            PROJECT.KEY,
            ISSUE.NUMBER,
            ISSUE.TITLE,
            AGENT_WORK.STATE,
            AGENT_WORK.NOTE,
            AGENT_WORK.UPDATED_AT,
            stateChangedAt,
            stale,
            visible,
            mine)
        .from(AGENT_WORK)
        .join(ISSUE)
        .on(ISSUE.ID.eq(AGENT_WORK.ISSUE_ID))
        .join(PROJECT)
        .on(PROJECT.ID.eq(ISSUE.PROJECT_ID))
        .where(AGENT_WORK.WORKER_ID.in(workerIds))
        .and(AgentWorkRepository.liveWork())
        .and(ISSUE.DELETED_AT.isNull())
        .and(PROJECT.DELETED_AT.isNull())
        .orderBy(AGENT_WORK.ID.asc())
        .fetch(
            r ->
                new WorkRow(
                    r.get(AGENT_WORK.WORKER_ID),
                    r.get(ISSUE.ID),
                    r.get(ISSUE.PARENT_ISSUE_ID),
                    r.get(PROJECT.KEY),
                    r.get(ISSUE.NUMBER),
                    r.get(ISSUE.TITLE),
                    r.get(AGENT_WORK.STATE),
                    r.get(AGENT_WORK.NOTE),
                    instant(r.get(AGENT_WORK.UPDATED_AT)),
                    instant(r.get(stateChangedAt)),
                    Boolean.TRUE.equals(r.get(stale)),
                    Boolean.TRUE.equals(r.get(visible)),
                    Boolean.TRUE.equals(r.get(mine))));
  }

  /**
   * 작업자마다 마지막으로 작업을 끝낸 시각 — 끝낸 작업이 없으면 키가 없다. 작업자마다 최근 한 건만 읽는 상관 서브쿼리로, 끝난 행 전체를 모으지 않고
   * agent_work_worker_ended_idx(V238)를 탄다.
   */
  public Map<Long, Instant> findLastEndedAt(Collection<Long> workerIds) {
    if (workerIds.isEmpty()) return Map.of();
    AgentWork w = AGENT_WORK.as("w");
    Field<OffsetDateTime> last =
        DSL.select(w.ENDED_AT)
            .from(w)
            .where(w.WORKER_ID.eq(USER.ID))
            .and(w.ENDED_AT.isNotNull())
            .orderBy(w.ENDED_AT.desc())
            .limit(1)
            .asField("last_ended_at");
    Map<Long, Instant> result = new HashMap<>();
    dsl.select(USER.ID, last)
        .from(USER)
        .where(USER.ID.in(workerIds))
        .fetch()
        .forEach(
            r -> {
              if (r.get(last) != null) result.put(r.get(USER.ID), r.get(last).toInstant());
            });
    return result;
  }

  private static Instant instant(OffsetDateTime t) {
    return t == null ? null : t.toInstant();
  }
}
