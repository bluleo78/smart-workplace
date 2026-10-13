package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Record;
import org.springframework.stereotype.Repository;

/** AI 작업 기록 저장소(WP-377). 진행 중 = ended_at IS NULL. 모든 갱신은 updated_at 을 now() 로 올린다. */
@Repository
@RequiredArgsConstructor
public class AgentWorkRepository {

  private final DSLContext dsl;

  /** 작업 행 조회 결과. 시각은 Instant 로 변환해 돌려준다. */
  public record AgentWorkRow(
      long id,
      long issueId,
      long workerId,
      String tool,
      String state,
      String note,
      Integer progress,
      Integer stepsDone,
      Integer stepsTotal,
      Instant startedAt,
      Instant updatedAt) {}

  /** 작업 행 + 작업자 요약(목록·상세 표시용). */
  public record AgentWorkWithWorker(AgentWorkRow work, UserSummary worker) {}

  /** (이슈, 작업자)의 진행 중 작업 1건. */
  public Optional<AgentWorkRow> findActive(long issueId, long workerId) {
    return dsl.selectFrom(AGENT_WORK)
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.eq(workerId))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .fetchOptional()
        .map(AgentWorkRepository::toRow);
  }

  /**
   * 진행 중 작업이 없으면 만든다. 부분 유니크(agent_work_active_uq)와 충돌하면 아무것도 넣지 않고 기존 진행 중 행을 돌려준다 — 동시 첫 보고가 멱등이
   * 되도록(예외 대신 재조회).
   */
  public Optional<AgentWorkRow> insertIfAbsent(
      long issueId, long workerId, String tool, String state) {
    dsl.insertInto(AGENT_WORK)
        .set(AGENT_WORK.ISSUE_ID, issueId)
        .set(AGENT_WORK.WORKER_ID, workerId)
        .set(AGENT_WORK.TOOL, tool)
        .set(AGENT_WORK.STATE, state)
        .onConflictDoNothing()
        .execute();
    return findActive(issueId, workerId);
  }

  /** 부분 갱신 — null 필드는 유지, clearNote 면 note 를 NULL 로. 항상 updated_at 을 now() 로 올린다(터치 겸용). */
  public void update(long id, AgentWorkPatch patch) {
    var step = dsl.update(AGENT_WORK).set(AGENT_WORK.UPDATED_AT, OffsetDateTime.now());
    if (patch.tool() != null) step = step.set(AGENT_WORK.TOOL, patch.tool());
    if (patch.state() != null) step = step.set(AGENT_WORK.STATE, patch.state());
    if (patch.clearNote()) {
      step = step.setNull(AGENT_WORK.NOTE);
    } else if (patch.note() != null) {
      step = step.set(AGENT_WORK.NOTE, patch.note());
    }
    if (patch.progress() != null)
      step = step.set(AGENT_WORK.PROGRESS, patch.progress().shortValue());
    if (patch.stepsDone() != null)
      step = step.set(AGENT_WORK.STEPS_DONE, patch.stepsDone().shortValue());
    if (patch.stepsTotal() != null)
      step = step.set(AGENT_WORK.STEPS_TOTAL, patch.stepsTotal().shortValue());
    step.where(AGENT_WORK.ID.eq(id)).execute();
  }

  /** 이슈의 진행 중 작업을 모두 종료한다. 종료한 행 수 반환. */
  public int endActive(long issueId) {
    return dsl.update(AGENT_WORK)
        .set(AGENT_WORK.ENDED_AT, OffsetDateTime.now())
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .execute();
  }

  /** 이슈에서 지정한 작업자들의 진행 중 작업만 종료한다(담당자에서 빠진 경우 등). */
  public int endActiveForWorkers(long issueId, Collection<Long> workerIds) {
    if (workerIds == null || workerIds.isEmpty()) return 0;
    return dsl.update(AGENT_WORK)
        .set(AGENT_WORK.ENDED_AT, OffsetDateTime.now())
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.in(workerIds))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .execute();
  }

  /** id 로 진행 중 작업 1건을 종료한다. 이미 끝났거나 없으면 false. */
  public boolean endById(long id) {
    return dsl.update(AGENT_WORK)
            .set(AGENT_WORK.ENDED_AT, OffsetDateTime.now())
            .where(AGENT_WORK.ID.eq(id))
            .and(AGENT_WORK.ENDED_AT.isNull())
            .execute()
        > 0;
  }

  /** 이슈들의 진행 중 작업을 작업자 요약과 함께 한 번에 조회(N+1 회피). 이슈별 id 오름차순. 작업 없는 이슈는 키가 없다. */
  public Map<Long, List<AgentWorkWithWorker>> findActiveByIssueIds(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    var rows =
        dsl.select(AGENT_WORK.fields())
            .select(USER.USERNAME, USER.NAME, USER.KIND)
            .from(AGENT_WORK)
            .join(USER)
            .on(USER.ID.eq(AGENT_WORK.WORKER_ID))
            .where(AGENT_WORK.ISSUE_ID.in(issueIds))
            .and(AGENT_WORK.ENDED_AT.isNull())
            .orderBy(AGENT_WORK.ID.asc())
            .fetch();
    Map<Long, List<AgentWorkWithWorker>> result = new LinkedHashMap<>();
    for (Record r : rows) {
      var row = toRow(r);
      var worker =
          new UserSummary(row.workerId(), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND));
      result
          .computeIfAbsent(row.issueId(), k -> new ArrayList<>())
          .add(new AgentWorkWithWorker(row, worker));
    }
    return result;
  }

  /**
   * 사람이 이슈에 응답(챗 글·댓글 등)했을 때, 그 이슈에서 "답변 필요" 로 멈춘 AI 구성원 작업을 작업 중으로 되돌린다. 사람(도구 사용자) 작업은 건드리지 않는다.
   */
  public int resumeWaitingAgents(long issueId) {
    return dsl.update(AGENT_WORK)
        .set(AGENT_WORK.STATE, AgentWorkState.WORKING)
        .set(AGENT_WORK.UPDATED_AT, OffsetDateTime.now())
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .and(AGENT_WORK.STATE.eq(AgentWorkState.WAITING))
        .and(AGENT_WORK.WORKER_ID.in(dsl.select(USER.ID).from(USER).where(USER.KIND.eq("AGENT"))))
        .execute();
  }

  /** AGENT_WORK 컬럼을 가진 Record → AgentWorkRow (OffsetDateTime → Instant). */
  private static AgentWorkRow toRow(Record r) {
    OffsetDateTime started = r.get(AGENT_WORK.STARTED_AT);
    OffsetDateTime updated = r.get(AGENT_WORK.UPDATED_AT);
    return new AgentWorkRow(
        r.get(AGENT_WORK.ID),
        r.get(AGENT_WORK.ISSUE_ID),
        r.get(AGENT_WORK.WORKER_ID),
        r.get(AGENT_WORK.TOOL),
        r.get(AGENT_WORK.STATE),
        r.get(AGENT_WORK.NOTE),
        r.get(AGENT_WORK.PROGRESS) == null ? null : r.get(AGENT_WORK.PROGRESS).intValue(),
        r.get(AGENT_WORK.STEPS_DONE) == null ? null : r.get(AGENT_WORK.STEPS_DONE).intValue(),
        r.get(AGENT_WORK.STEPS_TOTAL) == null ? null : r.get(AGENT_WORK.STEPS_TOTAL).intValue(),
        started != null ? started.toInstant() : null,
        updated != null ? updated.toInstant() : null);
  }
}
