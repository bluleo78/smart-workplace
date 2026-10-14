package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.coalesce;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.inline;
import static org.jooq.impl.DSL.max;
import static org.jooq.impl.DSL.min;
import static org.jooq.impl.DSL.select;
import static org.jooq.impl.DSL.selectOne;

import com.workplace.issue.dto.AgentWorkState;
import com.workplace.issue.dto.AiTaskCounts;
import com.workplace.issue.dto.AiTaskCursor;
import com.workplace.issue.dto.IssueRow;
import com.workplace.user.dto.UserKind;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.CaseWhenStep;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.SelectField;
import org.springframework.stereotype.Repository;

/**
 * AI 위임 작업 목록·건수 조회(WP-377 §5.2). 범위는 /me/issues 와 같은 접근 범위({@link
 * IssueRepository#memberScopeCondition}) 안에서 "AI 에게 맡긴 이슈(DELEGATED) 또는 사람이 AI 도구로 작업 중인
 * 이슈(ASSISTED)" 로 좁히고, 사람이 할 일이 먼저 보이도록 급한 순(진행 중 작업 상태) → 마지막 보고 최근순 → id 로 정렬한다. 정렬 키가 (rank,
 * sortAt, id) 셋이라 페이지는 같은 셋으로 된 복합 커서({@link AiTaskCursor})로 넘긴다.
 */
@Repository
@RequiredArgsConstructor
public class AiTaskRepository {

  private final DSLContext dsl;
  private final IssueRepository issueRepository;

  /**
   * 목록·건수 조회 조건. all=false 면 "나와 관련"(내가 만든 AI 담당 이슈 + 내가 AI 도구로 작업 중인 이슈), true 면 접근 가능한 전체.
   * agentStates·statuses·priorities 는 비어 있으면 미적용. cursor 가 null 이면 첫 페이지.
   */
  public record AiTaskQuery(
      boolean all,
      List<String> agentStates,
      List<String> statuses,
      List<String> priorities,
      AiTaskCursor cursor,
      int size) {}

  /** 목록 행 — 다음 커서를 만들 수 있게 이슈 행과 함께 정렬 키(rank, sortAt)를 싣는다. */
  public record AiTaskRow(IssueRow row, int rank, Instant sortAt) {}

  /** 이 이슈(바깥 ISSUE 행)의 진행 중 작업 — 상관 서브쿼리 공용 조건. 정의는 {@link AgentWorkRepository#liveWork} 하나만 쓴다. */
  private static Condition activeWorkOfIssue() {
    return AgentWorkRepository.liveWork();
  }

  /**
   * 작업 상태 → 급한 순위 CASE. 순서는 {@link AgentWorkState#ACTIVE} 에서 만든다 — 상태 목록을 SQL 에 따로 적으면 자바 쪽 순위와 어긋날
   * 수 있어서. 모르는 값은 ELSE 없이 NULL(→ MIN 에서 무시).
   */
  private static Field<Integer> stateRankCase() {
    CaseWhenStep<String, Integer> c = null;
    for (String state : AgentWorkState.ACTIVE) {
      Field<Integer> rank = inline(AgentWorkState.rank(state));
      c =
          c == null
              ? org.jooq.impl.DSL.choose(AGENT_WORK.STATE).when(inline(state), rank)
              : c.when(inline(state), rank);
    }
    return c;
  }

  /** 정렬 키 1 — 진행 중 작업 중 가장 급한 상태의 순위, 작업이 없으면 맨 뒤(NO_WORK_RANK). */
  private static final Field<Integer> RANK =
      coalesce(
          field(select(min(stateRankCase())).from(AGENT_WORK).where(activeWorkOfIssue())),
          inline(AgentWorkState.NO_WORK_RANK));

  /** 정렬 키 2 — 진행 중 작업의 마지막 보고 시각(가장 최근), 작업이 없으면 이슈 수정 시각. */
  private static final Field<OffsetDateTime> SORT_AT =
      coalesce(
          field(select(max(AGENT_WORK.UPDATED_AT)).from(AGENT_WORK).where(activeWorkOfIssue())),
          ISSUE.UPDATED_AT);

  /** 급한 순으로 한 페이지를 조회한다. 정렬: rank ASC, sortAt DESC, id DESC. */
  public List<AiTaskRow> search(long callerId, AiTaskQuery q) {
    Condition where = baseCondition(callerId, q);
    if (q.agentStates() != null && !q.agentStates().isEmpty()) {
      where = where.and(hasActiveWorkIn(q.agentStates()));
    }
    if (q.cursor() != null) {
      where = where.and(afterCursor(q.cursor()));
    }

    var rankField = RANK.as("ai_rank");
    var sortAtField = SORT_AT.as("ai_sort_at");
    List<SelectField<?>> fields = new ArrayList<>(Arrays.asList(IssueRepository.ROW_FIELDS));
    fields.add(rankField);
    fields.add(sortAtField);

    return dsl.select(fields)
        .from(ISSUE)
        .where(where)
        .orderBy(RANK.asc(), SORT_AT.desc(), ISSUE.ID.desc())
        .limit(q.size())
        .fetch(
            r ->
                new AiTaskRow(
                    issueRepository.mapToRow(r), r.get(rankField), r.get(sortAtField).toInstant()));
  }

  /**
   * 빠른 필터 칩 건수 — 한 쿼리에서 전체와 상태별(FILTER WHERE)을 함께 센다. 범위·이슈 상태·우선순위는 목록과 같고 agentState·커서는 무시한다. 한
   * 이슈에 여러 작업이 있으면 해당 상태 작업이 하나라도 있는 칩마다 센다(목록의 agentState 필터와 같은 의미).
   */
  public AiTaskCounts counts(long callerId, AiTaskQuery q) {
    var r =
        dsl.select(
                count(),
                count().filterWhere(hasActiveWorkIn(List.of(AgentWorkState.INPUT_REQUIRED))),
                count().filterWhere(hasActiveWorkIn(List.of(AgentWorkState.REVIEW))),
                // 막힘 칩은 BLOCKED 와 AUTH_REQUIRED(인증 필요) 를 함께 센다 — 둘 다 사람이 풀어 줘야 진행되는 멈춤.
                count()
                    .filterWhere(
                        hasActiveWorkIn(
                            List.of(AgentWorkState.BLOCKED, AgentWorkState.AUTH_REQUIRED))),
                count().filterWhere(hasActiveWorkIn(List.of(AgentWorkState.WORKING))))
            .from(ISSUE)
            .where(baseCondition(callerId, q))
            .fetchOne();
    return new AiTaskCounts(r.value1(), r.value2(), r.value3(), r.value4(), r.value5());
  }

  /** 목록·건수 공용 조건 — 접근 범위 AND AI 작업 범위 AND 이슈 상태·우선순위 필터. */
  private Condition baseCondition(long callerId, AiTaskQuery q) {
    Condition where =
        issueRepository.memberScopeCondition(callerId).and(aiScope(callerId, q.all()));
    if (q.statuses() != null && !q.statuses().isEmpty()) {
      where = where.and(ISSUE.STATUS.in(q.statuses()));
    }
    if (q.priorities() != null && !q.priorities().isEmpty()) {
      where = where.and(ISSUE.PRIORITY.in(q.priorities()));
    }
    return where;
  }

  /**
   * AI 작업 범위 — DELEGATED(담당자에 AI 구성원) OR ASSISTED(사람의 진행 중 작업). "나와 관련"이면 DELEGATED 는 내가 만든 이슈만(기존
   * 웹 규칙), ASSISTED 는 작업자가 나인 것만.
   */
  private static Condition aiScope(long callerId, boolean all) {
    Condition delegated =
        exists(
            selectOne()
                .from(ISSUE_ASSIGNEE)
                .join(USER)
                .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
                .and(USER.KIND.eq(UserKind.AGENT)));
    Condition humanWork = activeWorkOfIssue().and(USER.KIND.eq(UserKind.HUMAN));
    if (!all) {
      delegated = delegated.and(ISSUE.REPORTER_ID.eq(callerId));
      humanWork = humanWork.and(AGENT_WORK.WORKER_ID.eq(callerId));
    }
    Condition assisted =
        exists(
            selectOne()
                .from(AGENT_WORK)
                .join(USER)
                .on(USER.ID.eq(AGENT_WORK.WORKER_ID))
                .where(humanWork));
    return delegated.or(assisted);
  }

  /** 진행 중 작업 중 지정 상태가 하나라도 있는 이슈. */
  private static Condition hasActiveWorkIn(List<String> states) {
    return exists(
        selectOne().from(AGENT_WORK).where(activeWorkOfIssue()).and(AGENT_WORK.STATE.in(states)));
  }

  /**
   * 커서 다음 행 — 정렬(rank ASC, sortAt DESC, id DESC) 기준으로 커서 행보다 뒤인 것: rank &gt; r OR (rank = r AND
   * (sortAt &lt; t OR (sortAt = t AND id &lt; i))). 시각은 timestamptz 로 비교한다(마이크로초 그대로).
   */
  private static Condition afterCursor(AiTaskCursor c) {
    OffsetDateTime t = c.sortAt().atOffset(ZoneOffset.UTC);
    return RANK.gt(c.rank())
        .or(RANK.eq(c.rank()).and(SORT_AT.lt(t).or(SORT_AT.eq(t).and(ISSUE.ID.lt(c.id())))));
  }
}
