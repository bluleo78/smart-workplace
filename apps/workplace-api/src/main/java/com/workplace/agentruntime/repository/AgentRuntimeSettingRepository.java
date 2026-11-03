package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.dto.RunnerObservedAgent;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.With;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;

/**
 * AI 별 실행 설정(agent_runtime_setting) 리포지토리(WP-1247). 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로
 * 보장된다(애플리케이션은 tenant_id 를 넣지 않는다). 관찰 칸(observed_* 등)은 runner 보고({@link #updateObserved},
 * WP-1249)가 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class AgentRuntimeSettingRepository {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final TypeReference<LinkedHashMap<String, String>> CONFIG_TYPE =
      new TypeReference<>() {};

  private final DSLContext dsl;

  /**
   * 실행 설정 한 행(원하는 상태 + 관찰 상태). 원하는 상태 칸은 {@code withXxx} 로 바꾼 다음 행을 만들어 {@link #update} 에 넘긴다 —
   * 호출자가 바뀌지 않은 칸을 되풀이해 넘기지 않게.
   */
  public record Row(
      long agentUserId,
      @With String templateName,
      @With String templateVersion,
      @With Long locationId,
      @With Map<String, String> config,
      @With Desired desired,
      @With ApplyMode applyMode,
      @With long generation,
      Long observedGeneration,
      String phase,
      String observedMessage,
      Integer cpuMillicores,
      Long memoryBytes,
      OffsetDateTime startedAt,
      OffsetDateTime observedAt,
      String agentState,
      String agentIssueKey,
      OffsetDateTime agentNextCheckAt,
      OffsetDateTime agentReportedAt) {

    /** 아직 반영하지 않은 generation 이 있는지 — generation ≠ 마지막 관찰 generation(뜬 적 없으면 늘 참). */
    public boolean hasUnappliedGeneration() {
      return !Objects.equals(observedGeneration, generation);
    }

    /** AI 가 마지막으로 쉬는 중(IDLE)이라고 보고했는지. */
    public boolean isIdle() {
      return AgentState.IDLE.name().equals(agentState);
    }
  }

  /**
   * AI 상태 보고를 쓴 뒤의 행과 쓰기 전 화면용 값(WP-1250·1254) — 「쉬는 중으로 막 바뀜」을 가려 변경 이벤트를 한 번만 내고({@code
   * before.agentState()}), 화면에 보이는 값이 달라졌을 때만 관리자 화면에 알리게 한다. 보고는 agent_* 칸만 바꾸므로 나머지 칸은 쓴 뒤 행과 같다.
   */
  public record AgentStateUpdate(Row row, VisibleRuntimeState before) {}

  private Row map(Record r) {
    return new Row(
        r.get(AGENT_RUNTIME_SETTING.AGENT_USER_ID),
        r.get(AGENT_RUNTIME_SETTING.TEMPLATE_NAME),
        r.get(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION),
        r.get(AGENT_RUNTIME_SETTING.LOCATION_ID),
        readConfig(r.get(AGENT_RUNTIME_SETTING.CONFIG)),
        Desired.valueOf(r.get(AGENT_RUNTIME_SETTING.DESIRED)),
        ApplyMode.valueOf(r.get(AGENT_RUNTIME_SETTING.APPLY_MODE)),
        r.get(AGENT_RUNTIME_SETTING.GENERATION),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION),
        r.get(AGENT_RUNTIME_SETTING.PHASE),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_MESSAGE),
        r.get(AGENT_RUNTIME_SETTING.CPU_MILLICORES),
        r.get(AGENT_RUNTIME_SETTING.MEMORY_BYTES),
        r.get(AGENT_RUNTIME_SETTING.STARTED_AT),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_AT),
        r.get(AGENT_RUNTIME_SETTING.AGENT_STATE),
        r.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY),
        r.get(AGENT_RUNTIME_SETTING.AGENT_NEXT_CHECK_AT),
        r.get(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT));
  }

  /** 단건 — 다른 워크스페이스의 설정은 RLS 로 보이지 않는다. */
  public Optional<Row> find(long agentUserId) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(this::map);
  }

  /** 이 워크스페이스의 모든 실행 설정 — AI id 순(WP-1254 — 관리자 AI 목록의 실행 상태 요약). 다른 워크스페이스의 행은 RLS 로 보이지 않는다. */
  public List<Row> findAll() {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .orderBy(AGENT_RUNTIME_SETTING.AGENT_USER_ID)
        .fetch(this::map);
  }

  /**
   * 위치를 지정하지 않은(기본 위치를 따르는) 실행 설정들 — AI id 순(WP-1264 — 기본 위치를 옮기면 이 AI 들의 실제 위치가 바뀐다). 켜짐·꺼짐 모두.
   */
  public List<Row> findUnassigned() {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.LOCATION_ID.isNull())
        .orderBy(AGENT_RUNTIME_SETTING.AGENT_USER_ID)
        .fetch(this::map);
  }

  /**
   * 단건을 {@code SELECT … FOR UPDATE} 로 잠가 읽는다 — 켜기·끄기·설정 변경이 같은 AI 에 동시에 와도 generation 이 차례로 오르게 한다.
   */
  public Optional<Row> findForUpdate(long agentUserId) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .forUpdate()
        .fetchOptional(this::map);
  }

  /** 실제 위치가 그 위치인 설정 조건 — 위치를 직접 지정했거나, {@code isDefault} 면(그 위치가 기본일 때) 위치를 지정하지 않은 설정까지. */
  private static Condition locatedAt(long locationId, boolean isDefault) {
    Condition at = AGENT_RUNTIME_SETTING.LOCATION_ID.eq(locationId);
    return isDefault ? at.or(AGENT_RUNTIME_SETTING.LOCATION_ID.isNull()) : at;
  }

  /**
   * 그 위치에서 켜져 있어야 하는(desired RUN·실제 위치가 그 위치) 설정 조건 — runner 의 desired·키 발급·모델 연결 조회와 자리 수
   * 세기({@link AgentLocationRepository#countRunning})가 같은 규칙을 쓴다.
   */
  static Condition runningAt(long locationId, boolean isDefault) {
    return AGENT_RUNTIME_SETTING
        .DESIRED
        .eq(Desired.RUN.name())
        .and(locatedAt(locationId, isDefault));
  }

  /**
   * 그 위치에서 켜져 있어야 하는(desired RUN) 설정들 — runner 의 desired 응답용(WP-1249). AI id 순. 다른 워크스페이스의 행은 RLS 로
   * 보이지 않는다.
   */
  public List<Row> findRunningAt(long locationId, boolean isDefault) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(runningAt(locationId, isDefault))
        .orderBy(AGENT_RUNTIME_SETTING.AGENT_USER_ID)
        .fetch(this::map);
  }

  /**
   * 이 위치에서 켜져 있어야 하는(desired RUN·실제 위치가 이 위치) 한 AI 의 설정을 잠가 읽는다(WP-1253 — runner 의 키 발급). 잠금은
   * 켜기·끄기와 같은 설정 행이라, 같은 AI 의 키 발급 둘이나 발급과 끄기가 차례로 선다. 아니면 empty.
   */
  public Optional<Row> findRunningAtForUpdate(
      long agentUserId, long locationId, boolean isDefault) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .and(runningAt(locationId, isDefault))
        .forUpdate()
        .fetchOptional(this::map);
  }

  /** 이 위치에서 켜져 있어야 하는 AI 인지(WP-1253 — runner 의 모델 연결 조회). */
  public boolean isRunningAt(long agentUserId, long locationId, boolean isDefault) {
    return dsl.fetchExists(
        AGENT_RUNTIME_SETTING,
        AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId).and(runningAt(locationId, isDefault)));
  }

  /**
   * runner 관찰 보고 한 건을 쓴 결과(WP-1254) — 쓴 뒤 행과 쓰기 전 화면용 값. 호출자가 「화면에 보이는 것이 바뀌었는지」를 다시 읽지 않고 메모리에서
   * 견주게 한다.
   */
  public record ObservedUpdate(Row row, VisibleRuntimeState before) {}

  /**
   * runner 가 본 관찰 상태들을 한 문장(UPDATE … FROM (VALUES …) … RETURNING)으로 쓴다(WP-1249·1254) — 실제 위치가 그 위치인
   * 행만 고친다(조건을 WHERE 에 두어 읽고 쓰는 사이 위치가 바뀌어도 남의 행을 고치지 않는다). desired 는 보지 않는다 — 꺼진 AI 의
   * STOPPING·STOPPED 보고도 받아야 상태가 「끄는 중」에 머물지 않는다. 원하는 상태 칸·generation·updated_at 은 건드리지 않는다.
   *
   * <p>WP-1253 보강:
   *
   * <ul>
   *   <li>observed_generation 은 줄지 않는다(GREATEST — Postgres 는 NULL 을 무시한다). 늦게 도착한 옛 Pod 보고가 값을 되돌려
   *       이미 적용한 generation 을 다시 적용하게 하거나 키 정리 판정을 흔들지 않게. 보고에 generation 이 없으면 그대로 둔다.
   *   <li>새 Pod 가 보이면(phase STARTING, 시작 시각이 바뀜, 관찰 generation 이 오름) 옛 Pod 가 보고한 AI 상태(agent_*)를
   *       지운다 — 옛 Pod 의 「쉬는 중」으로 새 Pod 를 바로 갈아치우지 않게. 단 AI 보고가 새 Pod 시작 뒤에 왔으면(agent_reported_at ≥
   *       보고한 startedAt) 그 보고는 새 Pod 의 것이라 남긴다.
   * </ul>
   *
   * <p>SET 의 오른쪽은 모두 고치기 전 값을 본다(Postgres UPDATE 규칙) — 새 Pod 판정이 옛 started_at·observed_generation 과
   * 비교된다. 쓰기 전 화면용 칸은 이 위치의 행만 잠가 읽는 FROM 부분 질의(before)에서 받아 RETURNING 으로 돌려준다(WP-1254 — 전후를 다시 읽지
   * 않는다). 한 문장 안에서 같은 행을 두 번 고칠 수 없으므로 같은 AI 의 보고가 여러 번 오면 마지막 것만 쓴다(예전 배치와 같이 뒤의 것이 이긴다).
   *
   * @return 고친 AI id → 결과(없는 AI·다른 위치의 AI 는 빠진다)
   */
  public Map<Long, ObservedUpdate> updateObserved(
      long locationId, boolean isDefault, List<RunnerObservedAgent> reports) {
    if (reports.isEmpty()) return Map.of();
    Map<Long, RunnerObservedAgent> last = new LinkedHashMap<>();
    for (RunnerObservedAgent o : reports) last.put(o.agentUserId(), o);

    var s = AGENT_RUNTIME_SETTING;
    List<org.jooq.Row7<Long, Long, String, String, Integer, Long, OffsetDateTime>> rows =
        new ArrayList<>();
    for (RunnerObservedAgent o : last.values()) {
      rows.add(
          DSL.row(
              DSL.cast(o.agentUserId(), s.AGENT_USER_ID.getDataType()),
              DSL.cast(o.observedGeneration(), s.OBSERVED_GENERATION.getDataType()),
              DSL.cast(o.phase(), s.PHASE.getDataType()),
              DSL.cast(o.message(), s.OBSERVED_MESSAGE.getDataType()),
              DSL.cast(o.cpuMillicores(), s.CPU_MILLICORES.getDataType()),
              DSL.cast(o.memoryBytes(), s.MEMORY_BYTES.getDataType()),
              DSL.cast(o.startedAt(), s.STARTED_AT.getDataType())));
    }
    @SuppressWarnings("unchecked")
    Table<?> v =
        DSL.values(rows.toArray(new org.jooq.Row7[0]))
            .as("v", "agent_user_id", "gen", "phase", "message", "cpu", "mem", "started_at");
    Field<Long> vId = v.field("agent_user_id", Long.class);
    Field<Long> vGen = v.field("gen", Long.class);
    Field<String> vPhase = v.field("phase", String.class);
    Field<String> vMessage = v.field("message", String.class);
    Field<Integer> vCpu = v.field("cpu", Integer.class);
    Field<Long> vMem = v.field("mem", Long.class);
    Field<OffsetDateTime> vStart = v.field("started_at", OffsetDateTime.class);

    // 쓰기 전 값 — 이 위치의 행만 잠가 읽는다(다른 위치의 AI 는 잠그지도 돌려주지도 않는다).
    var cur = s.as("cur");
    Condition curAt = cur.LOCATION_ID.eq(locationId);
    if (isDefault) curAt = curAt.or(cur.LOCATION_ID.isNull());
    Table<?> before =
        dsl.select(
                cur.AGENT_USER_ID,
                cur.OBSERVED_GENERATION.as("p_gen"),
                cur.PHASE.as("p_phase"),
                cur.OBSERVED_MESSAGE.as("p_message"),
                cur.STARTED_AT.as("p_started_at"),
                cur.AGENT_STATE.as("p_agent_state"),
                cur.AGENT_ISSUE_KEY.as("p_issue_key"),
                cur.AGENT_NEXT_CHECK_AT.as("p_next_check_at"))
            .from(cur)
            .where(cur.AGENT_USER_ID.in(last.keySet()))
            .and(curAt)
            .forUpdate()
            .asTable("before");
    Field<Long> beforeId = before.field(cur.AGENT_USER_ID.getName(), Long.class);
    Field<Long> pGen = before.field("p_gen", Long.class);
    Field<String> pPhase = before.field("p_phase", String.class);
    Field<String> pMessage = before.field("p_message", String.class);
    Field<OffsetDateTime> pStart = before.field("p_started_at", OffsetDateTime.class);
    Field<String> pAgentState = before.field("p_agent_state", String.class);
    Field<String> pIssueKey = before.field("p_issue_key", String.class);
    Field<OffsetDateTime> pNextCheck = before.field("p_next_check_at", OffsetDateTime.class);

    // 새 Pod 판정(보고 값이 없으면 그 근거는 보지 않는다) — 예전 건별 문장과 같은 규칙을 보고 값 칸으로 쓴다.
    Condition newPod =
        vPhase
            .eq("STARTING")
            .or(vStart.isNotNull().and(s.STARTED_AT.isDistinctFrom(vStart)))
            .or(
                vGen.isNotNull()
                    .and(s.OBSERVED_GENERATION.isNull().or(s.OBSERVED_GENERATION.lt(vGen))));
    // AI 보고가 새 Pod 시작 뒤에 왔으면 새 Pod 의 보고라 지우지 않는다.
    Condition reportedByNewPod =
        vStart.isNotNull().and(s.AGENT_REPORTED_AT.isNotNull()).and(s.AGENT_REPORTED_AT.ge(vStart));
    newPod = newPod.andNot(reportedByNewPod);

    List<SelectField<?>> returning = new ArrayList<>(List.of(s.fields()));
    returning.addAll(List.of(pGen, pPhase, pMessage, pStart, pAgentState, pIssueKey, pNextCheck));
    Map<Long, ObservedUpdate> out = new LinkedHashMap<>();
    dsl.update(s)
        .set(s.OBSERVED_GENERATION, DSL.greatest(s.OBSERVED_GENERATION, vGen))
        .set(s.PHASE, vPhase)
        .set(s.OBSERVED_MESSAGE, vMessage)
        .set(s.CPU_MILLICORES, vCpu)
        .set(s.MEMORY_BYTES, vMem)
        .set(s.STARTED_AT, vStart)
        .set(s.OBSERVED_AT, OffsetDateTime.now())
        .set(s.AGENT_STATE, clearedIf(newPod, s.AGENT_STATE))
        .set(s.AGENT_ISSUE_KEY, clearedIf(newPod, s.AGENT_ISSUE_KEY))
        .set(s.AGENT_NEXT_CHECK_AT, clearedIf(newPod, s.AGENT_NEXT_CHECK_AT))
        .set(s.AGENT_REPORTED_AT, clearedIf(newPod, s.AGENT_REPORTED_AT))
        .from(v, before)
        .where(s.AGENT_USER_ID.eq(vId))
        .and(s.AGENT_USER_ID.eq(beforeId))
        .and(locatedAt(locationId, isDefault))
        .returningResult(returning)
        .fetch()
        .forEach(
            r -> {
              Row row = map(r);
              out.put(
                  row.agentUserId(),
                  new ObservedUpdate(
                      row,
                      new VisibleRuntimeState(
                          r.get(pGen),
                          r.get(pPhase),
                          r.get(pMessage),
                          VisibleRuntimeState.instant(r.get(pStart)),
                          r.get(pAgentState),
                          r.get(pIssueKey),
                          VisibleRuntimeState.instant(r.get(pNextCheck)))));
            });
    return out;
  }

  /** {@code when} 이면 NULL, 아니면 지금 값 그대로. */
  private static <T> Field<T> clearedIf(Condition when, Field<T> column) {
    return DSL.when(when, DSL.castNull(column.getDataType())).otherwise(column);
  }

  /**
   * AI 가 스스로 보고한 상태를 쓴다(WP-1250) — 세 칸을 늘 함께 덮어써 쉬는 중 보고가 옛 이슈 키를 지운다. 보고 시각(agent_reported_at)도
   * 남겨, 지금 Pod 가 뜨기 전의 보고를 적용 판정에서 거를 수 있게 한다(WP-1253). 원하는 상태 칸·generation·runner 관찰 칸·updated_at
   * 은 건드리지 않는다(보고는 설정 변경이 아니다).
   *
   * <p>한 문장으로 쓰고 읽는다 — 쓰기 전 AI 상태는 같은 행을 잠가 읽는 FROM 부분 질의에서, 쓴 뒤 행은 RETURNING 에서 받는다(동시 보고가 와도 잠금
   * 순서대로 앞 보고의 결과를 「쓰기 전」으로 본다).
   *
   * @return 쓴 뒤 행과 쓰기 전 AI 상태(설정이 없으면 empty)
   */
  public Optional<AgentStateUpdate> updateAgentState(
      long agentUserId, AgentState state, String issueKey, OffsetDateTime nextCheckAt) {
    var cur = AGENT_RUNTIME_SETTING.as("cur");
    Table<?> before =
        dsl.select(
                cur.AGENT_USER_ID,
                cur.AGENT_STATE.as("previous_agent_state"),
                cur.AGENT_ISSUE_KEY.as("previous_issue_key"),
                cur.AGENT_NEXT_CHECK_AT.as("previous_next_check_at"))
            .from(cur)
            .where(cur.AGENT_USER_ID.eq(agentUserId))
            .forUpdate()
            .asTable("before");
    Field<Long> beforeId = before.field(cur.AGENT_USER_ID.getName(), Long.class);
    Field<String> previousState = before.field("previous_agent_state", String.class);
    Field<String> previousIssueKey = before.field("previous_issue_key", String.class);
    Field<OffsetDateTime> previousNextCheckAt =
        before.field("previous_next_check_at", OffsetDateTime.class);
    List<SelectField<?>> returning = new ArrayList<>(List.of(AGENT_RUNTIME_SETTING.fields()));
    returning.add(previousState);
    returning.add(previousIssueKey);
    returning.add(previousNextCheckAt);
    return dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_STATE, state.name())
        .set(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY, issueKey)
        .set(AGENT_RUNTIME_SETTING.AGENT_NEXT_CHECK_AT, nextCheckAt)
        .set(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT, OffsetDateTime.now())
        .from(before)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(beforeId))
        .returningResult(returning)
        .fetchOptional(
            r ->
                agentStateUpdate(
                    map(r),
                    r.get(previousState),
                    r.get(previousIssueKey),
                    r.get(previousNextCheckAt)));
  }

  /** 쓴 뒤 행 + 쓰기 전 agent_* 세 칸 → 상태 보고 결과(나머지 화면용 칸은 보고가 바꾸지 않아 쓴 뒤 행 값). */
  private static AgentStateUpdate agentStateUpdate(
      Row row, String previousState, String previousIssueKey, OffsetDateTime previousNextCheckAt) {
    VisibleRuntimeState after = VisibleRuntimeState.of(row);
    return new AgentStateUpdate(
        row,
        new VisibleRuntimeState(
            after.observedGeneration(),
            after.phase(),
            after.observedMessage(),
            after.startedAt(),
            previousState,
            previousIssueKey,
            VisibleRuntimeState.instant(previousNextCheckAt)));
  }

  /** 새 설정 — generation 1·desired STOP·apply_mode IDLE(컬럼 기본값). 넣은 행을 돌려준다(전이 모양을 컬럼 기본값에서 읽게). */
  public Row insert(
      long agentUserId,
      String templateName,
      String templateVersion,
      Long locationId,
      Map<String, String> config,
      long updatedBy) {
    return dsl.insertInto(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_USER_ID, agentUserId)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, templateName)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION, templateVersion)
        .set(AGENT_RUNTIME_SETTING.LOCATION_ID, locationId)
        .set(AGENT_RUNTIME_SETTING.CONFIG, writeConfig(config))
        .set(AGENT_RUNTIME_SETTING.UPDATED_BY, updatedBy)
        .returning()
        .fetchOne(this::map);
  }

  /** 원하는 상태 칸을 {@code next} 로 덮어쓴다(호출자가 바뀐 경우에만 부르고 generation 을 올려 넘긴다). 관찰 칸은 건드리지 않는다. */
  public void update(Row next, Long updatedBy) {
    dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, next.templateName())
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION, next.templateVersion())
        .set(AGENT_RUNTIME_SETTING.LOCATION_ID, next.locationId())
        .set(AGENT_RUNTIME_SETTING.CONFIG, writeConfig(next.config()))
        .set(AGENT_RUNTIME_SETTING.DESIRED, next.desired().name())
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, next.applyMode().name())
        .set(AGENT_RUNTIME_SETTING.GENERATION, next.generation())
        .set(AGENT_RUNTIME_SETTING.UPDATED_BY, updatedBy)
        .set(AGENT_RUNTIME_SETTING.UPDATED_AT, OffsetDateTime.now())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(next.agentUserId()))
        .execute();
  }

  /**
   * 키 교체용 generation 올리기(WP-1253) — generation +1 과 apply_mode 만 고친다. 관리자가 쓴
   * 칸(updated_by·updated_at·설정)은 그대로 둔다 — 시스템이 올린 교체가 「누가 언제 바꿨는지」를 지우지 않게. 아직 반영되지 않은 바로 적용(NOW)이
   * 걸려 있으면 NOW 를 지킨다. 호출자가 행을 잠근 뒤에 부른다.
   *
   * @param applyMode 걸 적용 시점(대기 중인 NOW 가 있으면 무시하고 NOW)
   * @return 올린 뒤 generation
   */
  public long bumpGenerationForRotation(long agentUserId, ApplyMode applyMode) {
    Condition pendingNow =
        AGENT_RUNTIME_SETTING
            .APPLY_MODE
            .eq(ApplyMode.NOW.name())
            .and(
                AGENT_RUNTIME_SETTING.OBSERVED_GENERATION.isDistinctFrom(
                    AGENT_RUNTIME_SETTING.GENERATION));
    return dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.GENERATION, AGENT_RUNTIME_SETTING.GENERATION.plus(1))
        .set(
            AGENT_RUNTIME_SETTING.APPLY_MODE,
            DSL.when(pendingNow, ApplyMode.NOW.name()).otherwise(applyMode.name()))
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .returning(AGENT_RUNTIME_SETTING.GENERATION)
        .fetchOne(AGENT_RUNTIME_SETTING.GENERATION);
  }

  public int delete(long agentUserId) {
    return dsl.deleteFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  private static JSONB writeConfig(Map<String, String> config) {
    try {
      return JSONB.valueOf(MAPPER.writeValueAsString(config == null ? Map.of() : config));
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("실행 설정을 저장 형식으로 바꾸지 못했습니다", e);
    }
  }

  private static Map<String, String> readConfig(JSONB json) {
    if (json == null || json.data() == null || json.data().isBlank()) return new LinkedHashMap<>();
    try {
      return MAPPER.readValue(json.data(), CONFIG_TYPE);
    } catch (JsonProcessingException e) {
      throw new IllegalStateException("저장된 실행 설정을 읽지 못했습니다", e);
    }
  }
}
