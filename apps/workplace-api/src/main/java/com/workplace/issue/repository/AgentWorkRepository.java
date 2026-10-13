package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.USER;

import com.workplace.global.dto.UserSummary;
import com.workplace.issue.dto.AgentWorkPatch;
import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.user.dto.UserKind;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Record;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 작업 기록 저장소(WP-377). 진행 중 = ended_at IS NULL. 모든 갱신은 updated_at 을 now() 로 올린다.
 *
 * <p>시각(updated_at·ended_at)은 JVM 시계가 아니라 DB 시계(current_timestamp)로 찍는다 — insert 의 DEFAULT now() 와
 * 같은 시계를 써야 무소식(2시간) 판정·급한 순 정렬이 앱 서버 간 시계 차이에 흔들리지 않는다.
 */
@Repository
@RequiredArgsConstructor
public class AgentWorkRepository {

  /** 무소식 판정 기준 — WORKING 인데 마지막 보고가 이 시간 이상 지났으면 stale. */
  public static final Duration STALE_AFTER = Duration.ofHours(2);

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

  /** 작업 행 + 작업자 요약(목록·상세 표시용). stale 은 DB 시계로 계산한 무소식 여부. */
  public record AgentWorkWithWorker(AgentWorkRow work, UserSummary worker, boolean stale) {}

  /**
   * "살아 있는 AI 작업" 의 단일 정의 — ISSUE 와 조인된 상태에서 진행 중(ended_at IS NULL)이고 이슈가 종료(DONE·CANCELED)되지 않은 행.
   * 종료 이슈에 남은 진행 중 행은 작업으로 치지 않는다(조회·순위·건수·범위·필터 일관). 상관 서브쿼리({@code AiTaskRepository})도 이 조건을 쓴다.
   */
  public static Condition liveWork() {
    return AGENT_WORK
        .ISSUE_ID
        .eq(ISSUE.ID)
        .and(AGENT_WORK.ENDED_AT.isNull())
        .and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED));
  }

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
    var step = dsl.update(AGENT_WORK).set(AGENT_WORK.UPDATED_AT, DSL.currentOffsetDateTime());
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

  /** 이슈들의 진행 중 작업을 한 번에 종료한다(종료 상태 진입은 1건, 이슈 삭제는 부모+자식 등). 종료한 행 수 반환. */
  public int endActive(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return 0;
    return dsl.update(AGENT_WORK)
        .set(AGENT_WORK.ENDED_AT, DSL.currentOffsetDateTime())
        .where(AGENT_WORK.ISSUE_ID.in(issueIds))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .execute();
  }

  /** 이슈에서 지정한 작업자들의 진행 중 작업만 종료한다(담당자에서 빠진 경우 등). */
  public int endActiveForWorkers(long issueId, Collection<Long> workerIds) {
    if (workerIds == null || workerIds.isEmpty()) return 0;
    return dsl.update(AGENT_WORK)
        .set(AGENT_WORK.ENDED_AT, DSL.currentOffsetDateTime())
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.WORKER_ID.in(workerIds))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .execute();
  }

  /** 프로젝트의 모든 이슈에서 지정 작업자의 진행 중 작업을 종료한다(프로젝트 멤버 제거 시 — 담당 매핑이 함께 지워지므로). */
  public int endActiveForWorkerInProject(long projectId, long workerId) {
    return dsl.update(AGENT_WORK)
        .set(AGENT_WORK.ENDED_AT, DSL.currentOffsetDateTime())
        .where(AGENT_WORK.WORKER_ID.eq(workerId))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .and(
            AGENT_WORK.ISSUE_ID.in(
                dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId))))
        .execute();
  }

  /**
   * 이슈들의 진행 중 작업을 작업자 요약과 함께 한 번에 조회(N+1 회피). 이슈별 id 오름차순. 작업 없는 이슈는 키가 없다.
   *
   * <p>종료(DONE·CANCELED)된 이슈의 작업은 진행 중 행이 남아 있어도 돌려주지 않는다 — 종료 처리와 자동 종료 사이 롤링 배포 등으로 남은 행이 화면에 "작업
   * 중" 으로 보이지 않게 하는 방어선.
   */
  public Map<Long, List<AgentWorkWithWorker>> findActiveByIssueIds(Collection<Long> issueIds) {
    if (issueIds == null || issueIds.isEmpty()) return Map.of();
    // 무소식(stale) 은 JVM 이 아니라 DB 시계로 판정 — updated_at 을 찍는 시계와 같아야 서버 간 시계 차이에 흔들리지 않는다.
    Field<Boolean> staleField =
        DSL.field(
                AGENT_WORK
                    .STATE
                    .eq(AgentWorkState.WORKING)
                    .and(
                        AGENT_WORK.UPDATED_AT.le(
                            DSL.field(
                                "now() - make_interval(secs => {0})",
                                OffsetDateTime.class, STALE_AFTER.toSeconds()))))
            .as("is_stale");
    var rows =
        dsl.select(AGENT_WORK.fields())
            .select(USER.USERNAME, USER.NAME, USER.KIND)
            .select(staleField)
            .from(AGENT_WORK)
            .join(USER)
            .on(USER.ID.eq(AGENT_WORK.WORKER_ID))
            .join(ISSUE)
            .on(ISSUE.ID.eq(AGENT_WORK.ISSUE_ID))
            .where(AGENT_WORK.ISSUE_ID.in(issueIds))
            .and(liveWork())
            .orderBy(AGENT_WORK.ID.asc())
            .fetch();
    Map<Long, List<AgentWorkWithWorker>> result = new LinkedHashMap<>();
    for (Record r : rows) {
      var row = toRow(r);
      var worker =
          new UserSummary(row.workerId(), r.get(USER.USERNAME), r.get(USER.NAME), r.get(USER.KIND));
      result
          .computeIfAbsent(row.issueId(), k -> new ArrayList<>())
          .add(new AgentWorkWithWorker(row, worker, Boolean.TRUE.equals(r.get(staleField))));
    }
    return result;
  }

  /**
   * 사람이 이슈에 응답(챗 글·댓글 등)했을 때, 그 이슈에서 "답변 필요" 로 멈춘 AI 구성원 작업을 작업 중으로 되돌린다. 사람(도구 사용자) 작업은 건드리지 않는다.
   */
  public int resumeWaitingAgents(long issueId) {
    return dsl.update(AGENT_WORK)
        .set(AGENT_WORK.STATE, AgentWorkState.WORKING)
        // 응답으로 질문이 해소됐으니 질문 note 를 지운다(남으면 "작업 중 · 질문" 으로 보인다).
        .setNull(AGENT_WORK.NOTE)
        .set(AGENT_WORK.UPDATED_AT, DSL.currentOffsetDateTime())
        .where(AGENT_WORK.ISSUE_ID.eq(issueId))
        .and(AGENT_WORK.ENDED_AT.isNull())
        .and(AGENT_WORK.STATE.eq(AgentWorkState.WAITING))
        .and(
            AGENT_WORK.WORKER_ID.in(
                dsl.select(USER.ID).from(USER).where(USER.KIND.eq(UserKind.AGENT))))
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
