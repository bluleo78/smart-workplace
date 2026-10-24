package com.workplace.issue.repository;

import static com.workplace.issue.repository.KeysetSeek.after;
import static com.workplace.issue.repository.KeysetSeek.utc;
import static com.workplace.jooq.Tables.AGENT_WORK;
import static com.workplace.jooq.Tables.ISSUE;
import static com.workplace.jooq.Tables.ISSUE_ASSIGNEE;
import static com.workplace.jooq.Tables.ISSUE_TYPE_DEF;
import static com.workplace.jooq.Tables.USER;
import static org.jooq.impl.DSL.coalesce;
import static org.jooq.impl.DSL.count;
import static org.jooq.impl.DSL.exists;
import static org.jooq.impl.DSL.field;
import static org.jooq.impl.DSL.firstValue;
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
import com.workplace.issue.repository.KeysetSeek.SeekKey;
import com.workplace.user.dto.UserKind;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.jooq.CaseWhenStep;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.SelectField;
import org.jooq.SortField;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 위임 작업 목록·건수 조회(WP-377 §5.2). 범위는 /me/issues 와 같은 접근 범위({@link
 * IssueRepository#memberScopeCondition}) 안에서 "AI 에게 맡긴 이슈(DELEGATED) 또는 사람이 AI 도구로 작업 중인
 * 이슈(ASSISTED)" 로 좁히고, 사람이 할 일이 먼저 보이도록 급한 순(진행 중 작업 상태) → 마지막 보고 최근순 → id 로 정렬한다. WP-375 부터 이 정렬을
 * 에픽 묶음 단위로 감싸 한 에픽의 행이 연속으로 나오고, WP-426 부터 다시 프로젝트 단위로 감싸 한 프로젝트의 행이 페이지를 넘어서도 연속으로 나온다(가장 급한 행을
 * 가진 프로젝트가 먼저 — 그래서 뒤 프로젝트의 답변 필요 행은 앞 프로젝트의 작업 중 행 뒤에 온다) — 정렬 키 10개(프로젝트 순위, 프로젝트 최근 시각, 프로젝트 id,
 * 묶음 순위, 묶음 최근 시각, 묶음 키, 머리 순서, rank, sortAt, id)를 같은 10개로 된 복합 커서({@link AiTaskCursor})로 넘긴다.
 *
 * <p><b>미완료(live) 보기에서만</b> 최근 시각보다 id 를 먼저 비교해, 같은 순위 안에서는 불변 id 로 동률을 깬다(WP-690) — 미완료 보기의 최근
 * 시각(진행 중 작업의 마지막 보고 시각)은 보고가 올 때마다 바뀌어, 같은 순위 프로젝트/에픽/행 순서가 조회마다 흔들리는 원인이었다. 완료(done) 보기의 최근 시각(종료
 * 시각)은 작업이 끝난 뒤 바뀌지 않는 안정적인 값이고 "최근 종료가 있는 프로젝트가 먼저" 라는 의도된 기능이라 그대로 최근 시각을 id 보다 먼저 둔다. 어느 쪽인지는
 * 요청이 종료 상태만 묻는지(terminal states 만 있고 active 가 없음 — 화면이 미완료/완료 두 보기를 배타적으로 요청)로 판정한다({@link
 * #search} 의 {@code liveTieBreak}).
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
   * 목록 행 — 다음 커서를 만들 수 있게 정렬 키 10개와 묶음 정보를 함께 싣는다. epicNumber 는 묶음 키가 에픽일 때만(그 밖은 null), groupSize
   * 는 필터 적용 후 묶음 행 수, projectSize 는 필터 적용 후 그 프로젝트의 행 수(WP-426 — 페이지와 무관하게 같은 값). endedWorkId 는 완료
   * 보기를 요청했을 때만 — 행의 대표 종료 작업 id(WP-396), 그 밖은 null.
   */
  public record AiTaskRow(
      IssueRow row,
      int projectRank,
      Instant projectSortAt,
      long projectId,
      int projectSize,
      int rank,
      Instant sortAt,
      long groupKey,
      int groupRank,
      Instant groupSortAt,
      int headOrder,
      int groupSize,
      Integer epicNumber,
      Long endedWorkId) {

    /** 이 행 다음부터 이어 읽는 커서 — 정렬 키 10개를 그대로 옮긴다. */
    public AiTaskCursor toCursor() {
      return new AiTaskCursor(
          projectRank,
          projectSortAt,
          projectId,
          groupRank,
          groupSortAt,
          groupKey,
          headOrder,
          rank,
          sortAt,
          row.id());
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

  /** 같은 종료 시각(이슈 완료가 한 문장으로 닫음)이면 착수 전이라 취소된 행을 뒤로 — 대표 종료 작업 선택의 동률 깨기. */
  private static final Field<Integer> CANCELED_LAST =
      when(AGENT_WORK.STATE.eq(AgentWorkState.CANCELED), inline(1)).otherwise(inline(0));

  /**
   * 이슈 1건의 AI 작업 요약(WP-396) — 바깥 ISSUE 행마다 LATERAL 로 agent_work 를 <b>한 번만</b> 훑어(issue_id 인덱스)
   * 미완료·완료 판정, 정렬 키, 대표 종료 작업까지 모두 집계한다. 이슈 단위 "나와 관련" 조건(EXISTS)도 이 안에서 한 번만 계산해 컬럼으로 쓴다 — 바깥에서
   * 조건마다 되풀이하지 않게. HAVING count(*) > 0 이라 작업 기록이 없는 이슈는 요약 행이 없어 조인에서 바로 빠진다 — 이 LATERAL 자체가 "작업 기록
   * 있음" 사전 필터다(issue_id 인덱스 한 번 조회로 끝나고, 이슈 단위 EXISTS 등 선택 목록은 HAVING 을 통과한 이슈에만 계산된다).
   *
   * <p>"진행 중"은 {@link AgentWorkRepository#liveWork} 와 같은 정의 — ended_at IS NULL 이면 상태와 무관하게 진행 중이고,
   * 이슈가 종료(DONE·CANCELED)되면 아니다. 급한 순위(ACTIVE 목록)는 정렬·칩에만 쓴다.
   *
   * <p>행이 걸리는 근거는 셋이고(WP-395), 후보 작업이 좁아지는 순서로 포개진다: AI 담당(delegated → 모든 작업) ⊇ 내 이슈(issueMine:
   * 보고자·담당자 → 사람 작업) ⊇ 내 작업(작업자가 나인 사람 작업). 근거별 대표 종료 작업(가장 최근 종료, 취소는 동률에서 뒤)과 그 종료 시각을 여기서 한 번
   * 구하고, 완료 판정({@link #done})·정렬 시각({@link #sortAt})·배지용 id({@link #endedWorkId})가 모두 이 하나({@link
   * #tier})를 쓴다 — 걸린 이유와 배지가 어긋나지 않게. 전체 범위면 issueMine 이 항상 참이라 내 작업 근거(my*)는 만들지 않는다.
   */
  private static final class WorkSummary {
    final Table<?> table;
    final boolean all;
    final Condition delegated;
    final Condition issueMine;
    final Field<Boolean> hasLiveCol;
    final Field<Integer> liveRank;
    final Field<OffsetDateTime> liveAt;
    final Field<Boolean> humanLive;
    final Field<Boolean> myLive;
    final Field<OffsetDateTime> allDoneAt;
    final Field<OffsetDateTime> humanDoneAt;
    final Field<OffsetDateTime> myDoneAt;
    final Field<Long> allDoneId;
    final Field<Long> humanDoneId;
    final Field<Long> myDoneId;

    /** 진행 중 상태 묶음 키 → 그 상태들 중 하나인 진행 중 작업이 있는지. */
    final Map<String, Field<Boolean>> liveIn = new LinkedHashMap<>();

    /**
     * @param terminal 완료 판정에 쓰는 종료 상태 집합(요청한 것, 없으면 넷 모두)
     * @param liveStateSets 진행 중 상태 필터 묶음 — 키로 찾는다(목록은 요청 하나, 건수는 칩별)
     * @param withDoneIds 대표 종료 작업 id 를 집계할지 — 완료 보기 목록에서만(건수·미완료 목록은 정렬된 배열 집계가 필요 없다)
     */
    WorkSummary(
        long callerId,
        boolean all,
        Collection<String> terminal,
        Map<String, List<String>> liveStateSets,
        boolean withDoneIds) {
      this.all = all;
      Condition live = AgentWorkRepository.liveRow();
      Condition ended = AGENT_WORK.ENDED_AT.isNotNull().and(AGENT_WORK.STATE.in(terminal));
      Condition human = USER.KIND.eq(UserKind.HUMAN);
      Condition mine = human.and(AGENT_WORK.WORKER_ID.eq(callerId));
      List<SelectField<?>> cols = new ArrayList<>();
      // 이슈 단위 조건 — 바깥 ISSUE 만 참조해 집계와 무관하게 LATERAL 실행당 한 번 계산된다.
      cols.add(field(agentAssigned()).as("w_agent_assigned"));
      if (!all) cols.add(field(issueMine(callerId)).as("w_issue_mine"));
      // 살아 있는 작업 — 진행 중 행이 있고 이슈 미종료(AgentWorkRepository.liveWork 와 같은 정의). 한 번만 계산해 판정·정렬이 컬럼으로
      // 쓴다.
      cols.add(
          field(DSL.condition(DSL.boolOr(live)).and(AgentWorkRepository.issueOpen()))
              .as("w_has_live"));
      cols.add(min(stateRankCase()).filterWhere(live).as("w_live_rank"));
      cols.add(max(AGENT_WORK.UPDATED_AT).filterWhere(live).as("w_live_at"));
      cols.add(DSL.boolOr(live.and(human)).as("w_human_live"));
      if (!all) cols.add(DSL.boolOr(live.and(mine)).as("w_my_live"));
      addDone(cols, "all", ended, withDoneIds);
      addDone(cols, "human", ended.and(human), withDoneIds);
      if (!all) addDone(cols, "my", ended.and(mine), withDoneIds);
      liveStateSets.forEach(
          (key, states) ->
              cols.add(DSL.boolOr(live.and(AGENT_WORK.STATE.in(states))).as("w_live_" + key)));
      table =
          DSL.lateral(
                  select(cols)
                      .from(AGENT_WORK)
                      .join(USER)
                      .on(USER.ID.eq(AGENT_WORK.WORKER_ID))
                      .where(AGENT_WORK.ISSUE_ID.eq(ISSUE.ID))
                      // 작업 기록이 없는 이슈는 요약 행 자체가 없다 → 조인에서 빠진다(사전 필터). 어느 보기든 작업 기록을 요구한다.
                      .having(count().gt(0)))
              .as("aw");
      Condition agentAssignedCol = DSL.condition(table.field("w_agent_assigned", Boolean.class));
      issueMine =
          all ? DSL.trueCondition() : DSL.condition(table.field("w_issue_mine", Boolean.class));
      delegated = all ? agentAssignedCol : agentAssignedCol.and(issueMine);
      hasLiveCol = table.field("w_has_live", Boolean.class);
      liveRank = table.field("w_live_rank", Integer.class);
      liveAt = table.field("w_live_at", OffsetDateTime.class);
      humanLive = table.field("w_human_live", Boolean.class);
      myLive = all ? null : table.field("w_my_live", Boolean.class);
      allDoneAt = table.field("w_all_done_at", OffsetDateTime.class);
      humanDoneAt = table.field("w_human_done_at", OffsetDateTime.class);
      myDoneAt = all ? null : table.field("w_my_done_at", OffsetDateTime.class);
      allDoneId = withDoneIds ? table.field("w_all_done_id", Long.class) : null;
      humanDoneId = withDoneIds ? table.field("w_human_done_id", Long.class) : null;
      myDoneId = withDoneIds && !all ? table.field("w_my_done_id", Long.class) : null;
      liveStateSets
          .keySet()
          .forEach(key -> liveIn.put(key, table.field("w_live_" + key, Boolean.class)));
    }

    /** 근거 하나의 대표 종료 작업 — 최근 종료 시각과, 같은 순서(종료 시각 DESC → 취소 뒤 → id DESC)의 첫 id. */
    private static void addDone(
        List<SelectField<?>> cols, String tier, Condition rows, boolean withId) {
      cols.add(max(AGENT_WORK.ENDED_AT).filterWhere(rows).as("w_" + tier + "_done_at"));
      if (!withId) return;
      cols.add(
          DSL.arrayGet(
                  DSL.arrayAgg(AGENT_WORK.ID)
                      .orderBy(AGENT_WORK.ENDED_AT.desc(), CANCELED_LAST, AGENT_WORK.ID.desc())
                      .filterWhere(rows),
                  1)
              .as("w_" + tier + "_done_id"));
    }

    /** 근거별 값 고르기 — AI 담당이면 모든 작업, 내 이슈면 사람 작업, 그 밖은 내 사람 작업(전체 범위엔 없음). */
    private <T> Field<T> tier(Field<T> allV, Field<T> humanV, Field<T> myV) {
      var c = when(delegated, allV);
      return all ? c.otherwise(humanV) : c.when(issueMine, humanV).otherwise(myV);
    }

    /** 살아 있는 작업이 있는지 — 진행 중 행(ended_at IS NULL, 상태 무관)이 있고 이슈가 종료(DONE·CANCELED)되지 않음. */
    Condition hasLive() {
      return DSL.condition(hasLiveCol);
    }

    /** 미완료 보기 — 살아 있는 작업이 있고, AI 담당이거나 / 내 이슈에서 사람 작업이 진행 중이거나 / 내 사람 작업이 진행 중. */
    Condition open() {
      Condition c = delegated.or(issueMine.and(DSL.condition(humanLive)));
      return hasLive().and(all ? c : c.or(DSL.condition(myLive)));
    }

    /** 완료 보기 — 살아 있는 작업이 없고(미완료와 배타), 근거별 후보 안에 요청한 종료 상태의 종료 작업이 있음. */
    Condition done() {
      return DSL.not(hasLive()).and(tier(allDoneAt, humanDoneAt, myDoneAt).isNotNull());
    }

    /** 대표 종료 작업 id — 살아 있는 작업이 없을 때만(완료 보기 행), 그 밖은 NULL. */
    Field<Long> endedWorkId() {
      return when(hasLive(), inline((Long) null, Long.class))
          .otherwise(tier(allDoneId, humanDoneId, myDoneId));
    }

    /** 정렬 키 1 — 살아 있는 작업 중 가장 급한 상태의 순위, 없거나 모르는 상태뿐이면 맨 뒤(NO_WORK_RANK). */
    Field<Integer> rank() {
      Field<Integer> last = inline(AgentWorkState.NO_WORK_RANK);
      return coalesce(when(hasLive(), liveRank), last);
    }

    /** 정렬 키 2 — 살아 있는 작업의 마지막 보고 시각, 없으면(완료 보기) 대표 종료 작업의 종료 시각, 그것도 없으면 이슈 수정 시각. */
    Field<OffsetDateTime> sortAt() {
      return coalesce(
          when(hasLive(), liveAt), tier(allDoneAt, humanDoneAt, myDoneAt), ISSUE.UPDATED_AT);
    }
  }

  /** AI 구성원이 담당자인 이슈(바깥 ISSUE). */
  private static Condition agentAssigned() {
    return exists(
        selectOne()
            .from(ISSUE_ASSIGNEE)
            .join(USER)
            .on(USER.ID.eq(ISSUE_ASSIGNEE.USER_ID))
            .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
            .and(USER.KIND.eq(UserKind.AGENT)));
  }

  /** "나와 관련" 이슈 단위 조건(WP-395) — 내가 보고자이거나 담당자. */
  private static Condition issueMine(long callerId) {
    return ISSUE
        .REPORTER_ID
        .eq(callerId)
        .or(
            exists(
                selectOne()
                    .from(ISSUE_ASSIGNEE)
                    .where(ISSUE_ASSIGNEE.ISSUE_ID.eq(ISSUE.ID))
                    .and(ISSUE_ASSIGNEE.USER_ID.eq(callerId))));
  }

  /**
   * 프로젝트·에픽 묶음 단위 급한 순 한 페이지(WP-375 §3.6, WP-426 §4.1). 묶음 키 = 에픽이면 자기 id, 부모가 에픽이면 부모 id, 그 밖은 자기
   * id. 정렬: 프로젝트 순위 ASC → (최근 시각, id) 두 키(미완료면 id 가 먼저 — WP-690) → 묶음 안 최소 순위 ASC → (묶음 최근 보고, 묶음
   * 키) 두 키(미완료면 묶음 키가 먼저) → 머리(에픽 행) 먼저 → 순위 ASC, (정렬 시각, id) 두 키(미완료면 id 가 먼저). 미완료 보기는 최근 시각이
   * 보고마다 바뀌는 휘발성 값이라 id 를 먼저 비교해 같은 순위 동률을 고정하고, 완료 보기는 최근 시각(종료 시각)이 안정적이고 "최근 종료가 있는 프로젝트가 위"가
   * 의도된 동작이라 그대로 최근 시각을 먼저 둔다(어느 쪽인지는 {@link #search} 의 {@code liveTieBreak}).
   *
   * <p>프로젝트 자리는 "그 프로젝트의 첫 행이 프로젝트 키 없는 정렬에서 서는 자리"다 — 프로젝트 순위 = 프로젝트 안 최소 묶음 순위, 프로젝트 최근 시각 = 그
   * 순위인 묶음들의 최근 시각 중 가장 최근((묶음 순위 ASC, 묶음 최근 시각 DESC) 첫 값). 프로젝트 전체의 최근 시각을 쓰면 덜 급한 최근 행이 프로젝트를 위로
   * 끌어올린다. 완료 보기는 순위가 모두 같아 "가장 최근 종료가 있는 프로젝트가 위"가 된다. 에픽 묶음은 프로젝트를 넘지 않는다(부모는 같은 프로젝트에서만 지정).
   *
   * <p>파생 테이블 세 단(1단: 필터 통과 행의 기본 키·묶음 키·프로젝트, 2단: 묶음 창 함수, 3단: 프로젝트 순위·크기·최근 시각 창 함수 — 2단의 묶음 값에
   * 기대므로 같은 단에서 못 구한다)으로 계산하고 바깥에서 seek 한다. 창 함수는 필터를 적용한 행만으로 커서 조건 <b>전</b>에 계산한다 — 빠른 필터를 켜면 걸러진
   * 행끼리 묶이고, 페이지가 달라도 묶음·프로젝트 값이 같아 묶음·프로젝트가 페이지 경계를 넘어도 이어진다. 1단 안의 범위 조건·작업 요약(LATERAL)은 1단 FROM
   * 의 ISSUE 를 참조한다(파생 테이블은 바깥 ISSUE 를 볼 수 없다).
   */
  public List<AiTaskRow> search(long callerId, AiTaskQuery q) {
    List<String> active = activeStates(q.agentStates());
    List<String> terminal = terminalStates(q.agentStates());
    WorkSummary w =
        new WorkSummary(
            callerId,
            q.all(),
            terminal.isEmpty() ? AgentWorkState.TERMINAL : terminal,
            active.isEmpty() ? Map.of() : Map.of(FILTER, active),
            !terminal.isEmpty());
    Condition where = facetCondition(callerId, q).and(viewCondition(w, active, terminal));

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

    // 1단: 필터를 통과한 행의 기본 정렬 키·묶음 키·프로젝트.
    Table<?> base =
        dsl.select(
                ISSUE.ID.as("b_id"),
                ISSUE.PROJECT_ID.as("b_project"),
                w.rank().as("b_rank"),
                w.sortAt().as("b_sort_at"),
                groupKey.as("b_group"),
                epicNumber.as("b_epic"),
                // 완료 보기를 요청했을 때만 대표 종료 작업 id — 미완료 행은 어차피 NULL 이고, 요청 안 하면 계산·조회하지 않는다.
                (terminal.isEmpty() ? inline((Long) null, Long.class) : w.endedWorkId())
                    .as("b_ended_work"))
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
    Field<Long> bProject = base.field("b_project", Long.class);
    Field<Integer> bRank = base.field("b_rank", Integer.class);
    Field<OffsetDateTime> bSortAt = base.field("b_sort_at", OffsetDateTime.class);
    Field<Long> bGroup = base.field("b_group", Long.class);
    Field<Integer> bEpic = base.field("b_epic", Integer.class);
    Field<Long> bEndedWork = base.field("b_ended_work", Long.class);

    // 2단: 묶음 창 함수(묶음 순위·최근 시각·크기)와 머리 순서(에픽 자신 행이면 0).
    Table<?> ranked =
        dsl.select(
                bId.as("r_id"),
                bProject.as("r_project"),
                bRank.as("r_rank"),
                bSortAt.as("r_sort_at"),
                bGroup.as("r_group"),
                bEpic.as("r_epic"),
                bEndedWork.as("r_ended_work"),
                min(bRank).over(partitionBy(bGroup)).as("r_group_rank"),
                max(bSortAt).over(partitionBy(bGroup)).as("r_group_sort_at"),
                count().over(partitionBy(bGroup)).as("r_group_size"),
                when(bGroup.eq(bId), inline(0)).otherwise(inline(1)).as("r_head"))
            .from(base)
            .asTable("ai_ranked");
    Field<Long> rProject0 = ranked.field("r_project", Long.class);

    // 3단(WP-426): 프로젝트 순위(프로젝트 안 최소 묶음 순위)·크기(필터 적용 후 행 수)·최근 시각. 2단 열은 그대로 넘긴다.
    // 최근 시각은 (묶음 순위 ASC, 묶음 최근 시각 DESC) 첫 값 — 최소 순위 묶음들 중 가장 최근(그 프로젝트 첫 행의 자리)이다. 프로젝트 전체 max 가
    // 아니다(덜 급한 최근 행이 프로젝트를 끌어올리면 안 된다). 묶음 최근 시각은 coalesce(…, updated_at) 의 max 라 NULL 이 아니다.
    Field<Integer> rGroupRank0 = ranked.field("r_group_rank", Integer.class);
    Field<OffsetDateTime> rGroupSortAt0 = ranked.field("r_group_sort_at", OffsetDateTime.class);
    List<SelectField<?>> projCols = new ArrayList<>(Arrays.asList(ranked.fields()));
    projCols.add(min(rGroupRank0).over(partitionBy(rProject0)).as("p_rank"));
    projCols.add(count().over(partitionBy(rProject0)).as("p_size"));
    projCols.add(
        firstValue(rGroupSortAt0)
            .over(partitionBy(rProject0).orderBy(rGroupRank0.asc(), rGroupSortAt0.desc()))
            .as("p_sort_at"));
    Table<?> sorted = dsl.select(projCols).from(ranked).asTable("ai_project");

    // 바깥 select·seek·ORDER BY 는 가장 바깥 단(3단)의 열만 볼 수 있다.
    Field<Long> rId = sorted.field("r_id", Long.class);
    Field<Long> rProject = sorted.field("r_project", Long.class);
    Field<Integer> rRank = sorted.field("r_rank", Integer.class);
    Field<OffsetDateTime> rSortAt = sorted.field("r_sort_at", OffsetDateTime.class);
    Field<Long> rGroup = sorted.field("r_group", Long.class);
    Field<Integer> rEpic = sorted.field("r_epic", Integer.class);
    Field<Integer> rGroupRank = sorted.field("r_group_rank", Integer.class);
    Field<OffsetDateTime> rGroupSortAt = sorted.field("r_group_sort_at", OffsetDateTime.class);
    Field<Integer> rGroupSize = sorted.field("r_group_size", Integer.class);
    Field<Integer> rHead = sorted.field("r_head", Integer.class);
    Field<Long> rEndedWork = sorted.field("r_ended_work", Long.class);
    Field<Integer> pRank = sorted.field("p_rank", Integer.class);
    Field<Integer> pSize = sorted.field("p_size", Integer.class);
    Field<OffsetDateTime> pSortAt = sorted.field("p_sort_at", OffsetDateTime.class);

    List<SelectField<?>> fields = new ArrayList<>(Arrays.asList(IssueRepository.ROW_FIELDS));
    fields.addAll(
        List.of(
            pRank,
            pSortAt,
            rProject,
            pSize,
            rRank,
            rSortAt,
            rGroup,
            rEpic,
            rGroupRank,
            rGroupSortAt,
            rGroupSize,
            rHead,
            rEndedWork));

    // 미완료(live) 보기인지 — terminal 상태만 요청했으면(active 없음) 완료 보기(WP-396 두 보기는 배타적으로 요청된다).
    // 미완료 보기의 최근 시각은 보고마다 바뀌는 휘발성 값이라 id 를 먼저 비교해 동률을 고정하고(WP-690), 완료 보기의 최근
    // 시각(종료 시각)은 바뀌지 않는 안정적인 값이자 "최근 종료가 있는 프로젝트가 위" 라는 의도된 동작이라 그대로 둔다.
    boolean liveTieBreak = terminal.isEmpty();

    Condition seek = noCondition();
    if (q.cursor() != null) {
      AiTaskCursor c = q.cursor();
      SeekKey<?> projectId = SeekKey.desc(rProject, c.projectId());
      SeekKey<?> projectSortAt = SeekKey.desc(pSortAt, utc(c.projectSortAt()));
      SeekKey<?> groupIdKey = SeekKey.desc(rGroup, c.groupKey());
      SeekKey<?> groupSortAt = SeekKey.desc(rGroupSortAt, utc(c.groupSortAt()));
      SeekKey<?> id = SeekKey.desc(ISSUE.ID, c.id());
      SeekKey<?> rowSortAt = SeekKey.desc(rSortAt, utc(c.sortAt()));
      List<SeekKey<?>> keys = new ArrayList<>();
      keys.add(SeekKey.asc(pRank, c.projectRank()));
      keys.addAll(
          liveTieBreak ? List.of(projectId, projectSortAt) : List.of(projectSortAt, projectId));
      keys.add(SeekKey.asc(rGroupRank, c.groupRank()));
      keys.addAll(
          liveTieBreak ? List.of(groupIdKey, groupSortAt) : List.of(groupSortAt, groupIdKey));
      keys.add(SeekKey.asc(rHead, c.headOrder()));
      keys.add(SeekKey.asc(rRank, c.rank()));
      keys.addAll(liveTieBreak ? List.of(id, rowSortAt) : List.of(rowSortAt, id));
      seek = after(keys);
    }

    List<SortField<?>> order = new ArrayList<>();
    order.add(pRank.asc());
    order.addAll(
        liveTieBreak
            ? List.<SortField<?>>of(rProject.desc(), pSortAt.desc())
            : List.<SortField<?>>of(pSortAt.desc(), rProject.desc()));
    order.add(rGroupRank.asc());
    order.addAll(
        liveTieBreak
            ? List.<SortField<?>>of(rGroup.desc(), rGroupSortAt.desc())
            : List.<SortField<?>>of(rGroupSortAt.desc(), rGroup.desc()));
    order.add(rHead.asc());
    order.add(rRank.asc());
    order.addAll(
        liveTieBreak
            ? List.<SortField<?>>of(ISSUE.ID.desc(), rSortAt.desc())
            : List.<SortField<?>>of(rSortAt.desc(), ISSUE.ID.desc()));

    // 이슈 행 컬럼(ROW_FIELDS)의 상태 이름·색은 상태 조인에서 읽는다(WP-870)
    return dsl.select(fields)
        .from(IssueRepository.ISSUE_WITH_STATUS)
        .join(sorted)
        .on(rId.eq(ISSUE.ID))
        .where(seek)
        .orderBy(order)
        .limit(q.size())
        .fetch(
            r ->
                new AiTaskRow(
                    issueRepository.mapToRow(r),
                    r.get(pRank),
                    r.get(pSortAt).toInstant(),
                    r.get(rProject),
                    r.get(pSize),
                    r.get(rRank),
                    r.get(rSortAt).toInstant(),
                    r.get(rGroup),
                    r.get(rGroupRank),
                    r.get(rGroupSortAt).toInstant(),
                    r.get(rHead),
                    r.get(rGroupSize),
                    r.get(rEpic),
                    r.get(rEndedWork)));
  }

  /** 건수 칩별 진행 중 상태 묶음 — 키로 집계 컬럼(w_live_<키>)을 찾는다(위치에 기대지 않게). */
  private static final Map<String, List<String>> CHIP_STATES = chipStates();

  /** 목록 진행 상태 필터 묶음의 키(viewCondition). */
  private static final String FILTER = "filter";

  private static Map<String, List<String>> chipStates() {
    Map<String, List<String>> m = new LinkedHashMap<>();
    m.put("input_required", List.of(AgentWorkState.INPUT_REQUIRED));
    m.put("review", List.of(AgentWorkState.REVIEW));
    // 막힘 칩은 BLOCKED 와 AUTH_REQUIRED(인증 필요) 를 함께 센다 — 둘 다 사람이 풀어 줘야 진행되는 멈춤.
    m.put("blocked", List.of(AgentWorkState.BLOCKED, AgentWorkState.AUTH_REQUIRED));
    m.put("working", List.of(AgentWorkState.WORKING));
    m.put("scheduled", List.of(AgentWorkState.SCHEDULED));
    return m;
  }

  /**
   * 빠른 필터 칩 건수 — 한 쿼리에서 미완료(all)·상태별·완료(done)를 FILTER WHERE 로 함께 센다. 작업 요약(LATERAL)은 이슈마다 한 번만
   * 계산한다. 범위·이슈 상태·우선순위는 목록과 같고 agentState·커서는 무시한다. 한 이슈에 여러 작업이 있으면 해당 상태 작업이 하나라도 있는 칩마다 센다.
   */
  public AiTaskCounts counts(long callerId, AiTaskQuery q) {
    WorkSummary w = new WorkSummary(callerId, q.all(), AgentWorkState.TERMINAL, CHIP_STATES, false);
    Condition open = w.open();
    Condition done = w.done();
    var r =
        dsl.select(
                count().filterWhere(open),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get("input_required")))),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get("review")))),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get("blocked")))),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get("working")))),
                count().filterWhere(open.and(DSL.condition(w.liveIn.get("scheduled")))),
                count().filterWhere(done))
            .from(ISSUE)
            .crossJoin(w.table)
            .where(facetCondition(callerId, q).and(open.or(done)))
            .fetchOne();
    return new AiTaskCounts(
        r.value1(), r.value2(), r.value3(), r.value4(), r.value5(), r.value6(), r.value7());
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
   * 보기 조건(WP-396). 상태 필터가 없으면 미완료 기본 보기. 진행 상태는 그 상태의 진행 중 작업이 있는 미완료 행(w.liveIn[FILTER]), 종료 상태는
   * 완료 보기이며 둘이 섞이면 OR. 작업 기록이 하나도 없는 이슈는 어느 보기에도 걸리지 않아 목록 밖이다 — AI 작업 범위(DELEGATED·ASSISTED)도 이 보기
   * 조건 안에 있다.
   */
  private static Condition viewCondition(
      WorkSummary w, List<String> active, List<String> terminal) {
    if (active.isEmpty() && terminal.isEmpty()) return w.open();
    Condition c = DSL.falseCondition();
    if (!active.isEmpty()) c = c.or(w.open().and(DSL.condition(w.liveIn.get(FILTER))));
    if (!terminal.isEmpty()) c = c.or(w.done());
    return c;
  }

  /** 목록·건수 공용 조건 — 접근 범위 AND 이슈 상태·우선순위 필터. 작업 기록 사전 필터는 작업 요약 LATERAL 이, AI 작업 범위는 보기 조건이 맡는다. */
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
