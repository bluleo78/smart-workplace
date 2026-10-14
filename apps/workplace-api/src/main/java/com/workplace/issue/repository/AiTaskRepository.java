package com.workplace.issue.repository;

import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.coalesce;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.inline;
import static org.jooq.impl.DSL.max;
import static org.jooq.impl.DSL.min;
import static org.jooq.impl.DSL.noCondition;
import static org.jooq.impl.DSL.partitionBy;
import static org.jooq.impl.DSL.select;
import static org.jooq.impl.DSL.selectOne;
import static org.jooq.impl.DSL.when;

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
import org.jooq.Table;
import org.springframework.stereotype.Repository;

/**
 * AI 위임 작업 목록·건수 조회(WP-377 §5.2). 범위는 /me/issues 와 같은 접근 범위({@link
 * IssueRepository#memberScopeCondition}) 안에서 "AI 에게 맡긴 이슈(DELEGATED) 또는 사람이 AI 도구로 작업 중인
 * 이슈(ASSISTED)" 로 좁히고, 사람이 할 일이 먼저 보이도록 급한 순(진행 중 작업 상태) → 마지막 보고 최근순 → id 로 정렬한다. WP-375 부터 이 정렬을
 * 에픽 묶음 단위로 감싸 한 에픽의 행이 연속으로 나온다 — 정렬 키 7개(묶음 순위, 묶음 최근 시각, 묶음 키, 머리 순서, rank, sortAt, id)를 같은 7개로
 * 된 복합 커서({@link AiTaskCursor})로 넘긴다.
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

  /**
   * 목록 행 — 다음 커서를 만들 수 있게 정렬 키 7개와 묶음 정보를 함께 싣는다. epicNumber 는 묶음 키가 에픽일 때만(그 밖은 null), groupSize 는
   * 필터 적용 후 묶음 행 수.
   */
  public record AiTaskRow(
      IssueRow row,
      int rank,
      Instant sortAt,
      long groupKey,
      int groupRank,
      Instant groupSortAt,
      int headOrder,
      int groupSize,
      Integer epicNumber) {

    /** 이 행 다음부터 이어 읽는 커서 — 정렬 키 7개를 그대로 옮긴다. */
    public AiTaskCursor toCursor() {
      return new AiTaskCursor(groupRank, groupSortAt, groupKey, headOrder, rank, sortAt, row.id());
    }
  }

  /** 에픽 유형 이름 — 묶음 키 판정에 쓴다(ISSUE_TYPE_DEF.NAME). */
  private static final String EPIC = "EPIC";

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

  /**
   * 에픽 묶음 단위 급한 순 한 페이지(WP-375 §3.6). 묶음 키 = 에픽이면 자기 id, 부모가 에픽이면 부모 id, 그 밖은 자기 id. 정렬: 묶음 안 최소 순위
   * ASC → 묶음 안 최근 보고 DESC → 묶음 키 DESC → 머리(에픽 행) 먼저 → 순위 ASC, 정렬 시각 DESC, id DESC.
   *
   * <p>파생 테이블 두 단(1단: 필터 통과 행의 기본 키·묶음 키, 2단: 묶음 창 함수)으로 계산하고 바깥에서 seek 한다. 창 함수는 필터를 적용한 행만으로 커서
   * 조건 <b>전</b>에 계산한다 — 빠른 필터를 켜면 걸러진 행끼리 묶이고, 페이지가 달라도 묶음 값이 같아 묶음이 페이지 경계를 넘어도 이어진다. 1단 안의 범위
   * 조건·RANK·SORT_AT 은 1단 FROM 의 ISSUE 를 참조한다(파생 테이블은 바깥 ISSUE 를 볼 수 없다).
   */
  public List<AiTaskRow> search(long callerId, AiTaskQuery q) {
    Condition where = baseCondition(callerId, q);
    if (q.agentStates() != null && !q.agentStates().isEmpty()) {
      where = where.and(hasActiveWorkIn(q.agentStates()));
    }

    var selfType = ISSUE_TYPE_DEF.as("ai_self_type");
    var parent = ISSUE.as("ai_parent");
    var parentType = ISSUE_TYPE_DEF.as("ai_parent_type");
    // 묶음 키·에픽 번호 — 자기가 에픽이면 자기, 부모가 에픽이면 부모, 그 밖은 자기 id(에픽 번호 없음 → ELSE 생략으로 NULL).
    Field<Long> groupKey =
        when(selfType.NAME.eq(EPIC), ISSUE.ID)
            .when(parentType.NAME.eq(EPIC), ISSUE.PARENT_ISSUE_ID)
            .otherwise(ISSUE.ID);
    Field<Integer> epicNumber =
        when(selfType.NAME.eq(EPIC), ISSUE.NUMBER).when(parentType.NAME.eq(EPIC), parent.NUMBER);

    // 1단: 필터를 통과한 행의 기본 정렬 키·묶음 키.
    Table<?> base =
        dsl.select(
                ISSUE.ID.as("b_id"),
                RANK.as("b_rank"),
                SORT_AT.as("b_sort_at"),
                groupKey.as("b_group"),
                epicNumber.as("b_epic"))
            .from(ISSUE)
            .join(selfType)
            .on(selfType.ID.eq(ISSUE.TYPE_ID))
            .leftJoin(parent)
            .on(parent.ID.eq(ISSUE.PARENT_ISSUE_ID))
            .leftJoin(parentType)
            .on(parentType.ID.eq(parent.TYPE_ID))
            .where(where)
            .asTable("ai_base");
    Field<Long> bId = base.field("b_id", Long.class);
    Field<Integer> bRank = base.field("b_rank", Integer.class);
    Field<OffsetDateTime> bSortAt = base.field("b_sort_at", OffsetDateTime.class);
    Field<Long> bGroup = base.field("b_group", Long.class);
    Field<Integer> bEpic = base.field("b_epic", Integer.class);

    // 2단: 묶음 창 함수(묶음 순위·최근 시각·크기)와 머리 순서(에픽 자신 행이면 0).
    Table<?> ranked =
        dsl.select(
                bId.as("r_id"),
                bRank.as("r_rank"),
                bSortAt.as("r_sort_at"),
                bGroup.as("r_group"),
                bEpic.as("r_epic"),
                min(bRank).over(partitionBy(bGroup)).as("r_group_rank"),
                max(bSortAt).over(partitionBy(bGroup)).as("r_group_sort_at"),
                count().over(partitionBy(bGroup)).as("r_group_size"),
                when(bGroup.eq(bId), inline(0)).otherwise(inline(1)).as("r_head"))
            .from(base)
            .asTable("ai_ranked");
    Field<Long> rId = ranked.field("r_id", Long.class);
    Field<Integer> rRank = ranked.field("r_rank", Integer.class);
    Field<OffsetDateTime> rSortAt = ranked.field("r_sort_at", OffsetDateTime.class);
    Field<Long> rGroup = ranked.field("r_group", Long.class);
    Field<Integer> rEpic = ranked.field("r_epic", Integer.class);
    Field<Integer> rGroupRank = ranked.field("r_group_rank", Integer.class);
    Field<OffsetDateTime> rGroupSortAt = ranked.field("r_group_sort_at", OffsetDateTime.class);
    Field<Integer> rGroupSize = ranked.field("r_group_size", Integer.class);
    Field<Integer> rHead = ranked.field("r_head", Integer.class);

    List<SelectField<?>> fields = new ArrayList<>(Arrays.asList(IssueRepository.ROW_FIELDS));
    fields.addAll(
        List.of(rRank, rSortAt, rGroup, rEpic, rGroupRank, rGroupSortAt, rGroupSize, rHead));

    Condition seek = noCondition();
    if (q.cursor() != null) {
      AiTaskCursor c = q.cursor();
      seek =
          after(
              List.of(
                  SeekKey.asc(rGroupRank, c.groupRank()),
                  SeekKey.desc(rGroupSortAt, utc(c.groupSortAt())),
                  SeekKey.desc(rGroup, c.groupKey()),
                  SeekKey.asc(rHead, c.headOrder()),
                  SeekKey.asc(rRank, c.rank()),
                  SeekKey.desc(rSortAt, utc(c.sortAt())),
                  SeekKey.desc(ISSUE.ID, c.id())));
    }

    return dsl.select(fields)
        .from(ISSUE)
        .join(ranked)
        .on(rId.eq(ISSUE.ID))
        .where(seek)
        .orderBy(
            rGroupRank.asc(),
            rGroupSortAt.desc(),
            rGroup.desc(),
            rHead.asc(),
            rRank.asc(),
            rSortAt.desc(),
            ISSUE.ID.desc())
        .limit(q.size())
        .fetch(
            r ->
                new AiTaskRow(
                    issueRepository.mapToRow(r),
                    r.get(rRank),
                    r.get(rSortAt).toInstant(),
                    r.get(rGroup),
                    r.get(rGroupRank),
                    r.get(rGroupSortAt).toInstant(),
                    r.get(rHead),
                    r.get(rGroupSize),
                    r.get(rEpic)));
  }

  /** 커서 시각(Instant) → timestamptz 비교 값. 마이크로초 그대로. */
  private static OffsetDateTime utc(Instant t) {
    return t.atOffset(ZoneOffset.UTC);
  }

  /** seek 정렬 키 하나 — 필드·커서 값·방향. */
  private record SeekKey<T>(Field<T> field, T value, boolean desc) {
    static <T> SeekKey<T> asc(Field<T> f, T v) {
      return new SeekKey<>(f, v, false);
    }

    static <T> SeekKey<T> desc(Field<T> f, T v) {
      return new SeekKey<>(f, v, true);
    }

    /** 이 키에서 커서 행보다 "뒤"(ASC 면 큼, DESC 면 작음). */
    Condition beyond() {
      return desc ? field.lt(value) : field.gt(value);
    }

    /** 이 키에서 커서 행과 같음 — 다음 키로 동률을 깬다. */
    Condition same() {
      return field.eq(value);
    }
  }

  /**
   * 커서 행 다음 행 조건 — 정렬 키를 사전식으로 비교한다: k1 뒤 OR (k1 같음 AND (k2 뒤 OR (k2 같음 AND …))). 방향이 섞인 키에도 맞다(행 값
   * 비교 (a,b) &gt; (x,y) 는 방향이 모두 같을 때만 쓸 수 있다).
   */
  private static Condition after(List<SeekKey<?>> keys) {
    Condition c = keys.get(keys.size() - 1).beyond();
    for (int i = keys.size() - 2; i >= 0; i--) {
      SeekKey<?> k = keys.get(i);
      c = k.beyond().or(k.same().and(c));
    }
    return c;
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
}
