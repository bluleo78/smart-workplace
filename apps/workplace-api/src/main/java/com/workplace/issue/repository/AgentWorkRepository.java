package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.AGENT_WORK_EVENT;
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
import org.jooq.Name;
import org.jooq.Record;
import org.jooq.ResultQuery;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 작업 기록 저장소(WP-377). 진행 중 = ended_at IS NULL, 종료 = ended_at 설정 + 종료
 * 상태(COMPLETED·FAILED·CANCELED·REJECTED). 모든 갱신은 updated_at 을 now() 로 올린다.
 *
 * <p>상태 변경 이력(agent_work_event)은 쓰기 경로마다 여기서 남긴다 — 변경 후 행을 {@code RETURNING} 으로 받아 같은 문장 안에서 이벤트로
 * 넣으므로 다시 읽지 않고, 문장 하나라 행 변경과 이벤트가 함께 성공·실패한다(트리거는 쓰지 않는다).
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
   * 되도록(예외 대신 재조회). 새로 들어간 경우에만 이벤트를 남기고, 충돌이면 RETURNING 이 비어 이벤트도 없다. tool 은 SUBMITTED 처럼 아직 모르면
   * null.
   */
  public Optional<AgentWorkRow> insertIfAbsent(
      long issueId, long workerId, String tool, String state) {
    recordEvents(
        dsl.insertInto(AGENT_WORK)
            .set(AGENT_WORK.ISSUE_ID, issueId)
            .set(AGENT_WORK.WORKER_ID, workerId)
            .set(AGENT_WORK.TOOL, tool)
            .set(AGENT_WORK.STATE, state)
            .onConflictDoNothing()
            .returning(EVENT_SOURCE_FIELDS));
    return findActive(issueId, workerId);
  }

  /**
   * 부분 갱신 — null 필드는 유지, clearNote 면 note 를 NULL 로. 항상 updated_at 을 now() 로 올린다(터치 겸용).
   * 상태·note·진행률·단계 중 하나라도 보낸 경우에만 이벤트를 남긴다 — 도구 값 갱신·터치만 하는 쓰기는 이력을 부풀리지 않는다.
   */
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
    var where = step.where(AGENT_WORK.ID.eq(id));
    if (isEventWorthy(patch)) {
      recordEvents(where.returning(EVENT_SOURCE_FIELDS));
    } else {
      where.execute();
    }
  }

  /** 이력에 남길 변화(상태·note·진행률·단계)가 패치에 있는지. */
  private static boolean isEventWorthy(AgentWorkPatch p) {
    return p.state() != null
        || p.note() != null
        || p.clearNote()
        || p.progress() != null
        || p.stepsDone() != null
        || p.stepsTotal() != null;
  }

  /**
   * 이슈들의 진행 중 작업을 한 번에 종료한다(종료 상태 진입은 1건, 이슈 삭제는 부모+자식 등). 행은 지우지 않고 지정한 종료 상태로 닫는다. 종료한 행 수 반환.
   */
  public int endActive(Collection<Long> issueIds, String terminalState) {
    if (issueIds == null || issueIds.isEmpty()) return 0;
    return end(terminalState, AGENT_WORK.ISSUE_ID.in(issueIds));
  }

  /** 이슈들의 진행 중 작업 중 지정한 상태의 것만 종료한다 — 이슈 완료 시 아직 착수 전(SUBMITTED)인 작업만 따로 취소 처리하는 데 쓴다. */
  public int endActiveInStates(
      Collection<Long> issueIds, Collection<String> fromStates, String terminalState) {
    if (issueIds == null || issueIds.isEmpty()) return 0;
    return end(
        terminalState, AGENT_WORK.ISSUE_ID.in(issueIds).and(AGENT_WORK.STATE.in(fromStates)));
  }

  /** 이슈에서 지정한 작업자들의 진행 중 작업만 종료한다(담당자에서 빠진 경우, 작업자 본인의 종료 보고 등). */
  public int endActiveForWorkers(long issueId, Collection<Long> workerIds, String terminalState) {
    if (workerIds == null || workerIds.isEmpty()) return 0;
    return end(
        terminalState, AGENT_WORK.ISSUE_ID.eq(issueId).and(AGENT_WORK.WORKER_ID.in(workerIds)));
  }

  /** 프로젝트의 모든 이슈에서 지정 작업자의 진행 중 작업을 종료한다(프로젝트 멤버 제거 시 — 담당 매핑이 함께 지워지므로). */
  public int endActiveForWorkerInProject(long projectId, long workerId, String terminalState) {
    return end(
        terminalState,
        AGENT_WORK
            .WORKER_ID
            .eq(workerId)
            .and(
                AGENT_WORK.ISSUE_ID.in(
                    dsl.select(ISSUE.ID).from(ISSUE).where(ISSUE.PROJECT_ID.eq(projectId)))));
  }

  /** 진행 중 행(조건 + ended_at IS NULL)을 종료 상태로 닫고 이벤트를 남긴다. 종료 상태가 아니면 DB 정합 CHECK 가 막기 전에 여기서 거절한다. */
  private int end(String terminalState, Condition where) {
    if (!AgentWorkState.isTerminal(terminalState)) {
      throw new IllegalArgumentException("종료 상태가 아님: " + terminalState);
    }
    return recordEvents(
        dsl.update(AGENT_WORK)
            .set(AGENT_WORK.STATE, terminalState)
            .set(AGENT_WORK.ENDED_AT, DSL.currentOffsetDateTime())
            .where(where)
            .and(AGENT_WORK.ENDED_AT.isNull())
            .returning(EVENT_SOURCE_FIELDS));
  }

  /** 이벤트로 옮길 변경 후 스냅샷 컬럼 — RETURNING 목록과 이벤트 INSERT 의 SELECT 가 같은 순서를 쓴다. */
  private static final List<Field<?>> EVENT_SOURCE_FIELDS =
      List.of(
          AGENT_WORK.ID,
          AGENT_WORK.STATE,
          AGENT_WORK.NOTE,
          AGENT_WORK.PROGRESS,
          AGENT_WORK.STEPS_DONE,
          AGENT_WORK.STEPS_TOTAL);

  /**
   * 행을 바꾸는 RETURNING 문을 CTE 로 감싸 그 결과를 agent_work_event 로 옮긴다({@code WITH u AS (UPDATE/INSERT …
   * RETURNING …) INSERT INTO agent_work_event SELECT … FROM u}). 바뀐 행이 없으면 이벤트도 없다. 바뀐(=이벤트가 남은) 행
   * 수를 돌려준다.
   */
  private int recordEvents(ResultQuery<?> changed) {
    Name u = DSL.name("u");
    var snapshot = DSL.table(u);
    return dsl.with(u)
        .as(changed)
        .insertInto(
            AGENT_WORK_EVENT,
            AGENT_WORK_EVENT.WORK_ID,
            AGENT_WORK_EVENT.STATE,
            AGENT_WORK_EVENT.NOTE,
            AGENT_WORK_EVENT.PROGRESS,
            AGENT_WORK_EVENT.STEPS_DONE,
            AGENT_WORK_EVENT.STEPS_TOTAL)
        .select(
            DSL.select(
                    DSL.field(DSL.name("u", "id"), Long.class),
                    DSL.field(DSL.name("u", "state"), String.class),
                    DSL.field(DSL.name("u", "note"), String.class),
                    DSL.field(DSL.name("u", "progress"), Short.class),
                    DSL.field(DSL.name("u", "steps_done"), Short.class),
                    DSL.field(DSL.name("u", "steps_total"), Short.class))
                .from(snapshot))
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
   * 사람이 이슈에 응답(챗 글·댓글 등)했을 때, 그 이슈에서 "답변 필요(INPUT_REQUIRED)" 로 멈춘 AI 구성원 작업을 작업 중으로 되돌린다. 사람(도구
   * 사용자) 작업은 건드리지 않는다. 인증 필요(AUTH_REQUIRED)는 사람이 글로 답해서 풀리는 게 아니라 권한을 준 뒤 AI 가 다시 쓰면 터치로 복귀하므로 여기서
   * 건드리지 않는다.
   */
  public int resumeInputRequiredAgents(long issueId) {
    return recordEvents(
        dsl.update(AGENT_WORK)
            .set(AGENT_WORK.STATE, AgentWorkState.WORKING)
            // 응답으로 질문이 해소됐으니 질문 note 를 지운다(남으면 "작업 중 · 질문" 으로 보인다).
            .setNull(AGENT_WORK.NOTE)
            .set(AGENT_WORK.UPDATED_AT, DSL.currentOffsetDateTime())
            .where(AGENT_WORK.ISSUE_ID.eq(issueId))
            .and(AGENT_WORK.ENDED_AT.isNull())
            .and(AGENT_WORK.STATE.eq(AgentWorkState.INPUT_REQUIRED))
            .and(
                AGENT_WORK.WORKER_ID.in(
                    dsl.select(USER.ID).from(USER).where(USER.KIND.eq(UserKind.AGENT))))
            .returning(EVENT_SOURCE_FIELDS));
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
