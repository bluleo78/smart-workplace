package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_SERVER_RUN;

import java.time.Duration;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * 서버 AI 의 이슈 실행(agent_server_run, WP-1986) — 끝 보고가 그 (이슈, AI) 의 마지막 도는 실행의 것인지 가른다(열의 뜻은 V338
 * COMMENT). 시각은 서버 시계(DB now())만 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class AgentServerRunRepository {

  private final DSLContext dsl;

  /**
   * 실행 시작을 넣고(이미 있으면 그대로) 그 (이슈, AI) 의 오래된 행을 지운다.
   *
   * @return 이 실행이 도는 실행이면 true, 이미 끝난 실행(묘비 포함)의 늦은 STARTED 면 false
   */
  public boolean insertStarted(long issueId, long agentId, UUID runId, Duration staleAfter) {
    purgeStale(issueId, agentId, runId, staleAfter);
    // 충돌해도 행을 돌려받으려고 같은 값으로 고친다 — 끝남 표시로 도는 실행인지 가른다.
    return dsl.insertInto(AGENT_SERVER_RUN)
            .set(AGENT_SERVER_RUN.ISSUE_ID, issueId)
            .set(AGENT_SERVER_RUN.AGENT_ID, agentId)
            .set(AGENT_SERVER_RUN.RUN_ID, runId)
            .onConflict(
                AGENT_SERVER_RUN.ISSUE_ID, AGENT_SERVER_RUN.AGENT_ID, AGENT_SERVER_RUN.RUN_ID)
            .doUpdate()
            .set(AGENT_SERVER_RUN.RUN_ID, DSL.excluded(AGENT_SERVER_RUN.RUN_ID))
            .returningResult(AGENT_SERVER_RUN.FINISHED_AT)
            .fetchOne()
            .value1()
        == null;
  }

  /** 실행 끝을 표시하고(행이 없으면 묘비를 넣는다) 그 (이슈, AI) 의 오래된 행을 지운다 — STARTED 가 오지 않는 경로에서도 묘비가 쌓이지 않게. */
  public void markFinished(long issueId, long agentId, UUID runId, Duration staleAfter) {
    purgeStale(issueId, agentId, runId, staleAfter);
    dsl.insertInto(AGENT_SERVER_RUN)
        .set(AGENT_SERVER_RUN.ISSUE_ID, issueId)
        .set(AGENT_SERVER_RUN.AGENT_ID, agentId)
        .set(AGENT_SERVER_RUN.RUN_ID, runId)
        .set(AGENT_SERVER_RUN.FINISHED_AT, DSL.currentOffsetDateTime())
        .onConflict(AGENT_SERVER_RUN.ISSUE_ID, AGENT_SERVER_RUN.AGENT_ID, AGENT_SERVER_RUN.RUN_ID)
        .doUpdate()
        .set(
            AGENT_SERVER_RUN.FINISHED_AT,
            DSL.coalesce(AGENT_SERVER_RUN.FINISHED_AT, DSL.currentOffsetDateTime()))
        .execute();
  }

  /** 다른 실행이 아직 돌아 미룬 실패 사유를 끝난 그 실행의 행에 남긴다. */
  public void deferFailure(long issueId, long agentId, UUID runId, String note) {
    dsl.update(AGENT_SERVER_RUN)
        .set(AGENT_SERVER_RUN.FAILED_NOTE, note)
        .where(runOf(issueId, agentId, runId))
        .execute();
  }

  /**
   * 미룬 실패 사유 중 끝난 지 {@code maxAge} 안의 가장 늦은 것을 돌려주고, 그 (이슈, AI) 의 사유를 모두 비운다 — 한 문장(CTE 의 UPDATE 와
   * 본 SELECT 는 같은 스냅숏을 봐 비우기 전 값을 고른다).
   */
  public Optional<String> takePendingFailure(long issueId, long agentId, Duration maxAge) {
    var cleared =
        DSL.name("cleared")
            .as(
                dsl.update(AGENT_SERVER_RUN)
                    .setNull(AGENT_SERVER_RUN.FAILED_NOTE)
                    .where(workerOf(issueId, agentId))
                    .and(AGENT_SERVER_RUN.FAILED_NOTE.isNotNull())
                    .returningResult(AGENT_SERVER_RUN.RUN_ID));
    return dsl.with(cleared)
        .select(AGENT_SERVER_RUN.FAILED_NOTE)
        .from(AGENT_SERVER_RUN)
        .where(workerOf(issueId, agentId))
        .and(AGENT_SERVER_RUN.FAILED_NOTE.isNotNull())
        .and(AGENT_SERVER_RUN.FINISHED_AT.gt(AgentWorkRepository.staleBefore(maxAge)))
        .orderBy(AGENT_SERVER_RUN.FINISHED_AT.desc())
        .limit(1)
        .fetchOptional(AGENT_SERVER_RUN.FAILED_NOTE);
  }

  /** 그 (이슈, AI) 의 미룬 실패 사유를 모두 비운다(값은 쓰지 않을 때). */
  public void discardPendingFailures(long issueId, long agentId) {
    clearFailedNotes(issueId, List.of(agentId));
  }

  /** (이슈, AI 들) 의 미룬 실패 사유를 모두 비운다 — 노드를 떠날 때(그 실패는 떠난 노드의 것이다). */
  public void discardPendingFailures(long issueId, Collection<Long> agentIds) {
    if (agentIds == null || agentIds.isEmpty()) return;
    clearFailedNotes(issueId, agentIds);
  }

  /** (이슈, AI) 에 아직 도는 실행이 있는지 — 끝난 행과 {@code staleAfter} 보다 오래전에 시작한 행(죽은 실행)은 세지 않는다. */
  public boolean hasLiveRun(long issueId, long agentId, Duration staleAfter) {
    return dsl.fetchExists(
        AGENT_SERVER_RUN,
        workerOf(issueId, agentId)
            .and(AGENT_SERVER_RUN.FINISHED_AT.isNull())
            .and(AGENT_SERVER_RUN.STARTED_AT.gt(AgentWorkRepository.staleBefore(staleAfter))));
  }

  /** 담당에서 빠진 AI 들의 도는 행을 지우고 미룬 실패 사유를 비운다 — 끝난 행은 늦은 STARTED 를 막도록 남긴다. */
  public void deleteForWorkers(long issueId, Collection<Long> agentIds) {
    if (agentIds == null || agentIds.isEmpty()) return;
    dsl.deleteFrom(AGENT_SERVER_RUN)
        .where(AGENT_SERVER_RUN.ISSUE_ID.eq(issueId))
        .and(AGENT_SERVER_RUN.AGENT_ID.in(agentIds))
        .and(AGENT_SERVER_RUN.FINISHED_AT.isNull())
        .execute();
    clearFailedNotes(issueId, agentIds);
  }

  /** 이슈들의 실행 행(끝난 행 포함)을 모두 지운다 — 이슈 완료·취소·삭제 때. */
  public void deleteByIssues(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return;
    dsl.deleteFrom(AGENT_SERVER_RUN).where(AGENT_SERVER_RUN.ISSUE_ID.in(issueIds)).execute();
  }

  /** 그 (이슈, AI) 의 오래된 행(도는 행은 시작, 끝난 행은 끝난 시각 기준)을 지운다 — 지금 실행의 행은 시작 시각을 지키려고 남긴다. */
  private void purgeStale(long issueId, long agentId, UUID keepRunId, Duration staleAfter) {
    dsl.deleteFrom(AGENT_SERVER_RUN)
        .where(workerOf(issueId, agentId))
        .and(AGENT_SERVER_RUN.RUN_ID.ne(keepRunId))
        .and(
            DSL.coalesce(AGENT_SERVER_RUN.FINISHED_AT, AGENT_SERVER_RUN.STARTED_AT)
                .le(AgentWorkRepository.staleBefore(staleAfter)))
        .execute();
  }

  /** (이슈, AI 들) 의 미룬 실패 사유를 비운다. */
  private void clearFailedNotes(long issueId, Collection<Long> agentIds) {
    dsl.update(AGENT_SERVER_RUN)
        .setNull(AGENT_SERVER_RUN.FAILED_NOTE)
        .where(AGENT_SERVER_RUN.ISSUE_ID.eq(issueId))
        .and(AGENT_SERVER_RUN.AGENT_ID.in(agentIds))
        .and(AGENT_SERVER_RUN.FAILED_NOTE.isNotNull())
        .execute();
  }

  /** 한 (이슈, AI) 의 행을 고르는 조건. */
  private static Condition workerOf(long issueId, long agentId) {
    return AGENT_SERVER_RUN.ISSUE_ID.eq(issueId).and(AGENT_SERVER_RUN.AGENT_ID.eq(agentId));
  }

  /** 한 실행의 행을 고르는 조건. */
  private static Condition runOf(long issueId, long agentId, UUID runId) {
    return workerOf(issueId, agentId).and(AGENT_SERVER_RUN.RUN_ID.eq(runId));
  }
}
