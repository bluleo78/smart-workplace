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
import com.workplace.issue.dto.IssueStatuses;
import com.workplace.user.dto.UserKind;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.jooq.CaseWhenStep;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.SelectField;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 위임 작업 목록·건수 조회(WP-377 §5.2). 범위는 /me/issues 와 같은 접근 범위({@link
 * IssueRepository#memberScopeCondition}) 안에서 "AI 에게 맡긴 이슈(DELEGATED) 또는 사람이 AI 도구로 작업 중인
 * 이슈(ASSISTED)" 로 좁히고, 사람이 할 일이 먼저 보이도록 급한 순(진행 중 작업 상태) → 마지막 보고 최근순 → id 로 정렬한다. WP-375 부터 이 정렬을
 * 에픽 묶음 단위로 감싸 한 에픽의 행이 연속으로 나온다 — 정렬 키 7개(묶음 순위, 묶음 최근 시각, 묶음 키, 머리 순서, rank, sortAt, id)를 같은 7개로
 * 된 복합 커서({@link AiTaskCursor})로 넘긴다.
 *
 * <p>WP-396 부터 보기가 둘로 나뉜다 — 미완료(기본: 진행 중 작업이 있는 이슈)와 완료(진행 중 작업 없이 종료 작업이 있는 이슈, 최근 종료순). 작업
 * 기록(agent_work)이 하나도 없는 이슈는 AI 담당이어도 어느 보기에도 나오지 않는다.
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
   * 필터 적용 후 묶음 행 수. endedWorkId 는 완료 보기를 요청했을 때만 — 행의 대표 종료 작업 id(WP-396), 그 밖은 null.
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
      Integer epicNumber,
      Long endedWorkId) {

    /** 이 행 다음부터 이어 읽는 커서 — 정렬 키 7개를 그대로 옮긴다. */
    public AiTaskCursor toCursor() {
      return new AiTaskCursor(groupRank, groupSortAt, groupKey, headOrder, rank, sortAt, row.id());
    }
  }

  /** 에픽 유형 이름 — 묶음 키 판정에 쓴다(ISSUE_TYPE_DEF.NAME). */
  private static final String EPIC = "EPIC";

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
              ? DSL.choose(AGENT_WORK.STATE).when(inline(state), rank)
              : c.when(inline(state), rank);
    }
    return c;
  }

  /**
   * "나와 관련" 판정(WP-395) — 이슈 단위 두 조건. issueMine: 내가 보고자이거나 담당자(전체 범위면 항상 참). delegated: AI 구성원이
   * 담당자이고 issueMine. 작업 단위 조건(작업자가 나)은 {@link WorkSummary} 의 my* 집계가 맡는다.
   */
  private record Scope(Condition delegated, Condition issueMine) {}

  private static Scope scope(long callerId, boolean all) {
    Condition agentAssigned =
        exists(
            selectOne()
                .from(ISSUE_ASSIGNEE)
                .join(USER)
                .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
                .and(USER.KIND.eq(UserKind.AGENT)));
    if (all) return new Scope(agentAssigned, DSL.trueCondition());
    Condition assignedToMe =
        exists(
            selectOne()
                .from(ISSUE_ASSIGNEE)
                .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
                .and(ISSUE_ASSIGNEE.USER_ID.eq(callerId)));
    Condition issueMine = ISSUE.REPORTER_ID.eq(callerId).or(assignedToMe);
    return new Scope(agentAssigned.and(issueMine), issueMine);
  }

  /** 내가 작업자인 사람 작업(전체 범위면 모든 사람 작업) — USER 가 조인돼 있어야 한다. */
  private static Condition myHumanWork(long callerId, boolean all) {
    Condition human = USER.KIND.eq(UserKind.HUMAN);
    return all ? human : human.and(AGENT_WORK.WORKER_ID.eq(callerId));
  }

  /**
   * 이슈 1건의 AI 작업 요약(WP-396) — 바깥 ISSUE 행마다 LATERAL 로 agent_work 를 <b>한 번만</b> 훑어 미완료·완료 판정과 정렬 키에
   * 필요한 값을 모두 집계한다(같은 상관 서브쿼리를 조건마다 되풀이하지 않게). 집계만 있고 GROUP BY 가 없어 작업이 없어도 한 행(값은 NULL)이 나온다.
   *
   * <p>"진행 중"은 {@link AgentWorkRepository#liveWork} 와 같은 정의(ended_at IS NULL + 이슈 미종료)다 — 행
   * 조건(ended_at)은 집계 안에서, 이슈 조건은 {@link #hasLive} 에서 건다.
   *
   * <p>행이 걸리는 근거는 셋이고(WP-395), 후보 작업이 좁아지는 순서로 포개진다: AI 담당(delegated → 모든 작업) ⊇ 내 이슈(issueMine → 사람
   * 작업) ⊇ 내 작업(작업자가 나인 사람 작업). 완료 보기의 정렬 시각·대표 종료 작업은 그 행을 걸리게 한 가장 넓은 근거의 후보 안에서 고른다 — 걸린 이유와 배지가
   * 어긋나지 않게.
   */
  private static final class WorkSummary {
    final Table<?> table;
    final Field<Integer> liveRank;
    final Field<OffsetDateTime> liveAt;
    final Field<Boolean> humanLive;
    final Field<Boolean> myLive;
    final Field<OffsetDateTime> doneAt;
    final Field<OffsetDateTime> humanDoneAt;
    final Field<OffsetDateTime> myDoneAt;

    /** liveStateSets 순서대로 — 그 상태들 중 하나인 진행 중 작업이 있는지. */
    final List<Field<Boolean>> liveIn = new ArrayList<>();

    /**
     * @param terminal 완료 판정에 쓰는 종료 상태 집합(요청한 것, 없으면 넷 모두)
     * @param liveStateSets 진행 중 상태 필터 묶음(목록은 요청 하나, 건수는 칩별)
     */
    WorkSummary(
        long callerId, boolean all, Collection<String> terminal, List<List<String>> liveStateSets) {
      Condition live = AGENT_WORK.ENDED_AT.isNull();
      Condition ended = AGENT_WORK.ENDED_AT.isNotNull().and(AGENT_WORK.STATE.in(terminal));
      Condition human = USER.KIND.eq(UserKind.HUMAN);
      Condition mine = myHumanWork(callerId, all);
      List<SelectField<?>> cols = new ArrayList<>();
      cols.add(min(stateRankCase()).filterWhere(live).as("w_live_rank"));
      cols.add(max(AGENT_WORK.UPDATED_AT).filterWhere(live).as("w_live_at"));
      cols.add(DSL.boolOr(live.and(human)).as("w_human_live"));
      cols.add(DSL.boolOr(live.and(mine)).as("w_my_live"));
      cols.add(max(AGENT_WORK.ENDED_AT).filterWhere(ended).as("w_done_at"));
      cols.add(max(AGENT_WORK.ENDED_AT).filterWhere(ended.and(human)).as("w_human_done_at"));
      cols.add(max(AGENT_WORK.ENDED_AT).filterWhere(ended.and(mine)).as("w_my_done_at"));
      for (int i = 0; i < liveStateSets.size(); i++) {
        cols.add(
            DSL.boolOr(live.and(AGENT_WORK.STATE.in(liveStateSets.get(i)))).as("w_live_in_" + i));
      }
      table =
          DSL.lateral(
                  select(cols)
                      .from(AGENT_WORK)
                      .join(USER)
                      .on(USER.ID.eq(AGENT_WORK.WORKER_ID))
                      .where(AGENT_WORK.ISSUE_ID.eq(ISSUE.ID)))
              .as("aw");
      liveRank = table.field("w_live_rank", Integer.class);
      liveAt = table.field("w_live_at", OffsetDateTime.class);
      humanLive = table.field("w_human_live", Boolean.class);
      myLive = table.field("w_my_live", Boolean.class);
      doneAt = table.field("w_done_at", OffsetDateTime.class);
      humanDoneAt = table.field("w_human_done_at", OffsetDateTime.class);
      myDoneAt = table.field("w_my_done_at", OffsetDateTime.class);
      for (int i = 0; i < liveStateSets.size(); i++) {
        liveIn.add(table.field("w_live_in_" + i, Boolean.class));
      }
    }

    /** 살아 있는 작업이 있는지 — 진행 중 행이 있고 이슈가 종료(DONE·CANCELED)되지 않음. 종료 이슈에 남은 진행 중 행은 작업으로 치지 않는다. */
    Condition hasLive() {
      return liveRank.isNotNull().and(ISSUE.STATUS.notIn(IssueStatuses.CLOSED));
    }

    /** 미완료 보기 — 살아 있는 작업이 있고, AI 담당이거나 / 내 이슈에서 사람 작업이 진행 중이거나 / 내 사람 작업이 진행 중. */
    Condition open(Scope sc) {
      return hasLive()
          .and(
              sc.delegated()
                  .or(sc.issueMine().and(DSL.condition(humanLive)))
                  .or(DSL.condition(myLive)));
    }

    /**
     * 완료 보기 — 살아 있는 작업이 없고(미완료와 배타), 요청한 종료 상태의 종료 작업이 근거별 후보(AI 담당 → 모든 작업, 내 이슈 → 사람 작업, 그 밖 → 내
     * 사람 작업) 안에 있음. 같은 후보가 정렬 시각({@link #sortAt})과 대표 종료 작업({@link #endedWorkId})에도 쓰인다.
     */
    Condition done(Scope sc) {
      return DSL.not(hasLive())
          .and(
              sc.delegated()
                  .and(doneAt.isNotNull())
                  .or(sc.issueMine().and(humanDoneAt.isNotNull()))
                  .or(myDoneAt.isNotNull()));
    }

    /** 정렬 키 1 — 살아 있는 작업 중 가장 급한 상태의 순위, 없으면 맨 뒤(NO_WORK_RANK). */
    Field<Integer> rank() {
      return when(hasLive(), liveRank).otherwise(inline(AgentWorkState.NO_WORK_RANK));
    }

    /** 정렬 키 2 — 살아 있는 작업의 마지막 보고 시각, 없으면(완료 보기) 근거별 후보의 최근 종료 시각, 그것도 없으면 이슈 수정 시각. */
    Field<OffsetDateTime> sortAt(Scope sc) {
      return coalesce(
          when(hasLive(), liveAt),
          when(sc.delegated(), doneAt).when(sc.issueMine(), humanDoneAt).otherwise(myDoneAt),
          ISSUE.UPDATED_AT);
    }
  }

  /**
   * 에픽 묶음 단위 급한 순 한 페이지(WP-375 §3.6). 묶음 키 = 에픽이면 자기 id, 부모가 에픽이면 부모 id, 그 밖은 자기 id. 정렬: 묶음 안 최소 순위
   * ASC → 묶음 안 최근 보고 DESC → 묶음 키 DESC → 머리(에픽 행) 먼저 → 순위 ASC, 정렬 시각 DESC, id DESC.
   *
   * <p>파생 테이블 두 단(1단: 필터 통과 행의 기본 키·묶음 키, 2단: 묶음 창 함수)으로 계산하고 바깥에서 seek 한다. 창 함수는 필터를 적용한 행만으로 커서
   * 조건 <b>전</b>에 계산한다 — 빠른 필터를 켜면 걸러진 행끼리 묶이고, 페이지가 달라도 묶음 값이 같아 묶음이 페이지 경계를 넘어도 이어진다. 1단 안의 범위
   * 조건·작업 요약(LATERAL)은 1단 FROM 의 ISSUE 를 참조한다(파생 테이블은 바깥 ISSUE 를 볼 수 없다).
   */
  public List<AiTaskRow> search(long callerId, AiTaskQuery q) {
    List<String> active = activeStates(q.agentStates());
    List<String> terminal = terminalStates(q.agentStates());
    WorkSummary w =
        new WorkSummary(
            callerId,
            q.all(),
            terminal.isEmpty() ? AgentWorkState.TERMINAL : terminal,
            active.isEmpty() ? List.of() : List.of(active));
    Scope sc = scope(callerId, q.all());
    Condition where = facetCondition(callerId, q).and(viewCondition(w, sc, active, terminal));

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
                w.rank().as("b_rank"),
                w.sortAt(sc).as("b_sort_at"),
                groupKey.as("b_group"),
                epicNumber.as("b_epic"),
                field(sc.delegated()).as("b_delegated"),
                field(sc.issueMine()).as("b_issue_mine"))
            .from(ISSUE)
            .crossJoin(w.table)
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
    Field<Boolean> bDelegated = base.field("b_delegated", Boolean.class);
    Field<Boolean> bIssueMine = base.field("b_issue_mine", Boolean.class);

    // 2단: 묶음 창 함수(묶음 순위·최근 시각·크기)와 머리 순서(에픽 자신 행이면 0).
    Table<?> ranked =
        dsl.select(
                bId.as("r_id"),
                bRank.as("r_rank"),
                bSortAt.as("r_sort_at"),
                bGroup.as("r_group"),
                bEpic.as("r_epic"),
                bDelegated.as("r_delegated"),
                bIssueMine.as("r_issue_mine"),
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
    Field<Boolean> rDelegated = ranked.field("r_delegated", Boolean.class);
    Field<Boolean> rIssueMine = ranked.field("r_issue_mine", Boolean.class);
    // 완료 보기를 요청했을 때만 행의 대표 종료 작업 id 를 고른다 — 미완료 보기 행에 종료 배지가 섞이지 않게(페이지 행에만 계산).
    Field<Long> endedWorkId =
        terminal.isEmpty()
            ? DSL.inline((Long) null, Long.class)
            : endedWorkId(callerId, q.all(), rDelegated, rIssueMine, terminal);

    List<SelectField<?>> fields = new ArrayList<>(Arrays.asList(IssueRepository.ROW_FIELDS));
    fields.addAll(
        List.of(
            rRank,
            rSortAt,
            rGroup,
            rEpic,
            rGroupRank,
            rGroupSortAt,
            rGroupSize,
            rHead,
            endedWorkId.as("ai_ended_work_id")));

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
                    r.get(rEpic),
                    r.get("ai_ended_work_id", Long.class)));
  }

  /**
   * 행의 대표 종료 작업 id(WP-396) — 완료 보기에서 행을 걸리게 한 것과 같은 조건(요청한 종료 상태, AI 담당이 아니면 (나의) 사람 작업만) 안에서 가장 최근
   * 종료 1건. 같은 종료 시각(이슈 완료가 한 문장으로 닫음)이면 착수 전이라 취소된 행보다 실제 결과를 고른다. 바깥 ISSUE 행을 참조하는 스칼라 서브쿼리라 페이지
   * 행에만 돈다(종료 인덱스 issue_id, ended_at DESC, id DESC 를 탄다).
   */
  private static Field<Long> endedWorkId(
      long callerId,
      boolean all,
      Field<Boolean> delegated,
      Field<Boolean> issueMine,
      Collection<String> terminal) {
    return field(
        select(AGENT_WORK.ID)
            .from(AGENT_WORK)
            .join(USER)
            .on(USER.ID.eq(AGENT_WORK.WORKER_ID))
            .where(AGENT_WORK.ISSUE_ID.eq(ISSUE.ID))
            .and(AGENT_WORK.ENDED_AT.isNotNull())
            .and(AGENT_WORK.STATE.in(terminal))
            // 근거별 후보 — AI 담당이면 모든 작업, 내 이슈면 사람 작업, 그 밖은 내 사람 작업(WorkSummary 의 done·sortAt 과 같다).
            .and(
                DSL.condition(delegated)
                    .or(DSL.condition(issueMine).and(USER.KIND.eq(UserKind.HUMAN)))
                    .or(myHumanWork(callerId, all)))
            .orderBy(
                AGENT_WORK.ENDED_AT.desc(),
                when(AGENT_WORK.STATE.eq(AgentWorkState.CANCELED), inline(1)).otherwise(inline(0)),
                AGENT_WORK.ID.desc())
            .limit(1));
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

  /** 건수 칩별 진행 중 상태 묶음 — 순서가 AiTaskCounts 의 inputRequired·review·blocked·working 과 같다. */
  private static final List<List<String>> CHIP_STATES =
      List.of(
          List.of(AgentWorkState.INPUT_REQUIRED),
          List.of(AgentWorkState.REVIEW),
          // 막힘 칩은 BLOCKED 와 AUTH_REQUIRED(인증 필요) 를 함께 센다 — 둘 다 사람이 풀어 줘야 진행되는 멈춤.
          List.of(AgentWorkState.BLOCKED, AgentWorkState.AUTH_REQUIRED),
          List.of(AgentWorkState.WORKING));

  /**
   * 빠른 필터 칩 건수 — 한 쿼리에서 미완료(all)·상태별·완료(done)를 FILTER WHERE 로 함께 센다. 작업 요약(LATERAL)은 이슈마다 한 번만
   * 계산한다. 범위·이슈 상태·우선순위는 목록과 같고 agentState·커서는 무시한다. 한 이슈에 여러 작업이 있으면 해당 상태 작업이 하나라도 있는 칩마다 센다.
   */
  public AiTaskCounts counts(long callerId, AiTaskQuery q) {
    WorkSummary w = new WorkSummary(callerId, q.all(), AgentWorkState.TERMINAL, CHIP_STATES);
    Scope sc = scope(callerId, q.all());
    Condition open = w.open(sc);
    Condition done = w.done(sc);
    var r =
        dsl.select(
                count().filterWhere(open),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get(0)))),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get(1)))),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get(2)))),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get(3)))),
                count().filterWhere(done))
            .from(ISSUE)
            .crossJoin(w.table)
            .where(facetCondition(callerId, q).and(open.or(done)))
            .fetchOne();
    return new AiTaskCounts(r.value1(), r.value2(), r.value3(), r.value4(), r.value5(), r.value6());
  }

  /** agentState 중 진행 상태. */
  private static List<String> activeStates(List<String> states) {
    return states == null ? List.of() : states.stream().filter(AgentWorkState::isActive).toList();
  }

  /** agentState 중 종료 상태 — 있으면 완료 보기를 요청한 것. */
  private static List<String> terminalStates(List<String> states) {
    return states == null ? List.of() : states.stream().filter(AgentWorkState::isTerminal).toList();
  }

  /**
   * 보기 조건(WP-396). 상태 필터가 없으면 미완료 기본 보기. 진행 상태는 그 상태의 진행 중 작업이 있는 미완료 행(w.liveIn[0]), 종료 상태는 완료
   * 보기이며 둘이 섞이면 OR. 작업 기록이 하나도 없는 이슈는 어느 보기에도 걸리지 않아 목록 밖이다 — AI 작업 범위(DELEGATED·ASSISTED)도 이 보기 조건
   * 안에 있다.
   */
  private static Condition viewCondition(
      WorkSummary w, Scope sc, List<String> active, List<String> terminal) {
    if (active.isEmpty() && terminal.isEmpty()) return w.open(sc);
    Condition c = DSL.falseCondition();
    if (!active.isEmpty()) c = c.or(w.open(sc).and(DSL.condition(w.liveIn.get(0))));
    if (!terminal.isEmpty()) c = c.or(w.done(sc));
    return c;
  }

  /** 목록·건수 공용 조건 — 접근 범위 AND 이슈 상태·우선순위 필터. AI 작업 범위는 보기 조건이 맡는다. */
  private Condition facetCondition(long callerId, AiTaskQuery q) {
    Condition where = issueRepository.memberScopeCondition(callerId);
    if (q.statuses() != null && !q.statuses().isEmpty()) {
      where = where.and(ISSUE.STATUS.in(q.statuses()));
    }
    if (q.priorities() != null && !q.priorities().isEmpty()) {
      where = where.and(ISSUE.PRIORITY.in(q.priorities()));
    }
    return where;
  }
}
