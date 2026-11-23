package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SETTING;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.dto.RunnerObservedAgent;
import com.workplace.agentruntime.dto.RuntimeVersion;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.PodIdentity;
import com.workplace.global.json.JsonMappers;
import com.workplace.jooq.tables.AgentRuntimeSetting;
import com.workplace.jooq.tables.records.AgentRuntimeSettingRecord;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import lombok.With;
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.JSONB;
import org.jooq.Record;
import org.jooq.SelectField;
import org.jooq.Table;
import org.jooq.UpdateSetMoreStep;
import org.jooq.impl.DSL;
import org.springframework.stereotype.Repository;
import tools.jackson.core.JacksonException;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

/**
 * AI 별 실행 설정(agent_runtime_setting) 리포지토리(WP-1247). 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로
 * 보장된다(애플리케이션은 tenant_id 를 넣지 않는다). 관찰 칸(observed_* 등)은 runner 보고({@link #updateObserved},
 * WP-1249)가 쓴다.
 */
@Repository
@RequiredArgsConstructor
public class AgentRuntimeSettingRepository {

  private static final ObjectMapper MAPPER = JsonMappers.JACKSON2;
  private static final TypeReference<LinkedHashMap<String, String>> CONFIG_TYPE =
      new TypeReference<>() {};

  /**
   * 아직 반영하지 않은 generation 이 있다(generation ≠ 관찰 generation, null 도 다른 값으로 본다) — 걸려 있는 바로 적용
   * 지키기({@link #bumpGenerationForRotation})와 미뤄 둔 generation 의 NOW 표시({@link
   * #markPendingApplyNow})가 같은 판정을 쓴다(WP-1515).
   */
  private static final Condition UNAPPLIED_GENERATION =
      AGENT_RUNTIME_SETTING.GENERATION.isDistinctFrom(AGENT_RUNTIME_SETTING.OBSERVED_GENERATION);

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
      Long failedGeneration,
      String phase,
      String observedMessage,
      Integer cpuMillicores,
      Long memoryBytes,
      OffsetDateTime startedAt,
      String observedPodUid,
      String previousPodUid,
      OffsetDateTime observedAt,
      String agentState,
      String agentIssueKey,
      List<String> agentIssueKeys,
      OffsetDateTime agentNextCheckAt,
      OffsetDateTime agentReportedAt,
      String paneBlockedMessage,
      OffsetDateTime paneBlockedAt,
      Long paneBlockedGeneration,
      OffsetDateTime reportedPodStartedAt,
      OffsetDateTime paneBlockedPodStartedAt,
      @With boolean acceptNewWork,
      @With Integer slotLimit) {

    /** 아직 반영하지 않은 generation 이 있는지 — generation ≠ 마지막 관찰 generation(뜬 적 없으면 늘 참). */
    public boolean hasUnappliedGeneration() {
      return !Objects.equals(observedGeneration, generation);
    }

    /** AI 가 쉬는 중(IDLE)인지 — 칸별 보고를 합친 상태라 모든 칸이 쉴 때만 참이다(WP-1409). */
    public boolean isIdle() {
      return AgentState.IDLE.name().equals(agentState);
    }
  }

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
        r.get(AGENT_RUNTIME_SETTING.FAILED_GENERATION),
        r.get(AGENT_RUNTIME_SETTING.PHASE),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_MESSAGE),
        r.get(AGENT_RUNTIME_SETTING.CPU_MILLICORES),
        r.get(AGENT_RUNTIME_SETTING.MEMORY_BYTES),
        r.get(AGENT_RUNTIME_SETTING.STARTED_AT),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_POD_UID),
        r.get(AGENT_RUNTIME_SETTING.PREVIOUS_POD_UID),
        r.get(AGENT_RUNTIME_SETTING.OBSERVED_AT),
        r.get(AGENT_RUNTIME_SETTING.AGENT_STATE),
        r.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY),
        visibleIssueKeys(
            r.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEYS),
            r.get(AGENT_RUNTIME_SETTING.AGENT_ISSUE_KEY)),
        r.get(AGENT_RUNTIME_SETTING.AGENT_NEXT_CHECK_AT),
        r.get(AGENT_RUNTIME_SETTING.AGENT_REPORTED_AT),
        r.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_MESSAGE),
        r.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_AT),
        r.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_GENERATION),
        r.get(AGENT_RUNTIME_SETTING.REPORTED_POD_STARTED_AT),
        r.get(AGENT_RUNTIME_SETTING.PANE_BLOCKED_POD_STARTED_AT),
        r.get(AGENT_RUNTIME_SETTING.ACCEPT_NEW_WORK),
        Optional.ofNullable(r.get(AGENT_RUNTIME_SETTING.SLOT_LIMIT))
            .map(Short::intValue)
            .orElse(null));
  }

  /**
   * 화면·API 에 내보낼 현재 이슈 키 목록 — 이 규칙은 여기 한 곳에만 둔다(WP-1409). 롤링 배포 중 옛 API 인스턴스는
   * agent_state·agent_issue_key 만 쓰고 agent_issue_keys 배열은 모르고 남겨 두므로, 배열이 비어 있지 않고 첫 키가
   * agent_issue_key 와 같을 때만(새 인스턴스가 함께 쓴 값) 배열을 믿는다. 아니면 agent_issue_key 하나({@code [key]}), 그것도 없으면
   * 빈 목록.
   */
  static List<String> visibleIssueKeys(String[] keys, String issueKey) {
    if (keys != null && keys.length > 0 && keys[0] != null && keys[0].equals(issueKey)) {
      return List.of(keys);
    }
    return issueKey == null ? List.of() : List.of(issueKey);
  }

  /** 단건 — 다른 워크스페이스의 설정은 RLS 로 보이지 않는다. */
  public Optional<Row> find(long agentUserId) {
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional(this::map);
  }

  /** 주어진 AI 들의 실행 설정(WP-1754 — 동시 진행 상한을 한 번에 읽는다). 설정이 없는 AI 는 빠진다. */
  public List<Row> findByAgentIds(java.util.Collection<Long> agentUserIds) {
    if (agentUserIds.isEmpty()) return List.of();
    return dsl.selectFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.in(agentUserIds))
        .fetch(this::map);
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
    return locatedAt(AGENT_RUNTIME_SETTING, locationId, isDefault);
  }

  /** {@link #locatedAt(long, boolean)} 를 별칭 테이블에 건다 — 한 문장 안의 부분 질의(별칭)가 같은 규칙을 쓰게. */
  private static Condition locatedAt(
      com.workplace.jooq.tables.AgentRuntimeSetting t, long locationId, boolean isDefault) {
    Condition at = t.LOCATION_ID.eq(locationId);
    return isDefault ? at.or(t.LOCATION_ID.isNull()) : at;
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
   * runner 관찰 보고 한 건을 쓴 결과(WP-1254) — 쓴 뒤 행과 쓰기 전 행. 호출자가 「화면에 보이는 것이 바뀌었는지」·「적용 판정이
   * 바뀌었는지(WP-2000)」를 다시 읽지 않고 메모리에서 견주게 한다. 쓰기 전 행은 쓰기 전 값(p_* 칸)만으로 만든 행이다 — 쓴 뒤 행과 섞이지 않는다.
   */
  public record ObservedUpdate(Row row, Row before) {}

  /**
   * runner 가 본 관찰 상태들을 한 문장(UPDATE … FROM (VALUES …) … RETURNING)으로 쓴다(WP-1249·1254) — 실제 위치가 그 위치인
   * 행만 고친다(조건을 WHERE 에 두어 읽고 쓰는 사이 위치가 바뀌어도 남의 행을 고치지 않는다). 단 꺼진 AI(desired STOP)는 어느 위치의 보고든 받는다 —
   * 위치가 바뀐 뒤 옛 위치 runner 의 정지 보고가 버려져 「종료 중」에 머물지 않게(WP-1751). 켜진 AI 는 현재 위치의 보고만 받는다. 꺼진 AI 의
   * STOPPING·STOPPED 보고도 받아야 상태가 「끄는 중」에 머물지 않는다. 원하는 상태 칸·generation·updated_at 은 건드리지 않는다.
   *
   * <p>WP-1253 보강:
   *
   * <ul>
   *   <li>observed_generation 은 줄지 않는다(GREATEST — Postgres 는 NULL 을 무시한다). 늦게 도착한 옛 Pod 보고가 값을 되돌려
   *       이미 적용한 generation 을 다시 적용하게 하거나 키 정리 판정을 흔들지 않게. 보고에 generation 이 없으면 그대로 둔다.
   *   <li>새 Pod 가 보이면(phase STARTING, 시작 시각이 바뀜, 관찰 generation 이 오름, 보고 Pod 정체가 바뀜 — WP-1968) 옛 Pod
   *       가 보고한 AI 상태(agent_*)를 지운다 — 옛 Pod 의 「쉬는 중」으로 새 Pod 를 바로 갈아치우지 않게. 단 AI 보고가 새 Pod 시작 뒤에
   *       왔으면(agent_reported_at ≥ 보고한 startedAt) 그 보고는 새 Pod 의 것이라 남긴다.
   *   <li>observed_pod_uid 는 보고의 podUid 를 coalesce 로 적는다 — 없는 보고(옛 runner·일시 오류)는 지난 값을 지우지 않고, 다음
   *       작업이 이 값으로 보고의 주인을 가린다(WP-1968).
   * </ul>
   *
   * <p>SET 의 오른쪽은 모두 고치기 전 값을 본다(Postgres UPDATE 규칙) — 새 Pod 판정이 옛 started_at·observed_generation 과
   * 비교된다. 쓰기 전 행(WP-2000 — 화면용 칸·적용 판정 모두 이것으로 견준다)은 이 위치의 행(꺼진 AI 는 어느 위치든 — 정지 보고만 반영, WP-1751)만
   * 잠가 읽는 FROM 부분 질의(before)에서 받아 RETURNING 으로 돌려준다(WP-1254 — 전후를 다시 읽지 않는다). 한 문장 안에서 같은 행을 두 번 고칠
   * 수 없으므로 같은 AI 의 보고가 여러 번 오면 마지막 것만 쓴다(예전 배치와 같이 뒤의 것이 이긴다).
   *
   * @return 고친 AI id → 결과(없는 AI·다른 위치의 AI 는 빠진다. 단 꺼진 AI 의 STOPPING·STOPPED 보고는 다른 위치에서 와도 들어간다 —
   *     WP-1751)
   */
  public Map<Long, ObservedUpdate> updateObserved(
      long locationId, boolean isDefault, List<RunnerObservedAgent> reports) {
    if (reports.isEmpty()) return Map.of();
    Map<Long, RunnerObservedAgent> last = new LinkedHashMap<>();
    for (RunnerObservedAgent o : reports) last.put(o.agentUserId(), o);

    var s = AGENT_RUNTIME_SETTING;
    List<org.jooq.Row9<Long, Long, String, String, Integer, Long, OffsetDateTime, Long, String>>
        rows = new ArrayList<>();
    for (RunnerObservedAgent o : last.values()) {
      rows.add(
          DSL.row(
              DSL.cast(o.agentUserId(), s.AGENT_USER_ID.getDataType()),
              DSL.cast(o.observedGeneration(), s.OBSERVED_GENERATION.getDataType()),
              DSL.cast(o.phase(), s.PHASE.getDataType()),
              DSL.cast(o.message(), s.OBSERVED_MESSAGE.getDataType()),
              DSL.cast(o.cpuMillicores(), s.CPU_MILLICORES.getDataType()),
              DSL.cast(o.memoryBytes(), s.MEMORY_BYTES.getDataType()),
              DSL.cast(o.startedAt(), s.STARTED_AT.getDataType()),
              DSL.cast(o.failedGeneration(), s.FAILED_GENERATION.getDataType()),
              // 빈 정체(공백)는 null 로 — 메모리 판정이 공백을 「모른다」로 보는 것처럼 SQL 도 지난 정체로 보지 않고
              // COALESCE · 새 Pod 판정이 갈리지 않게 한다(WP-1968 2차 반려 ⑤).
              DSL.cast(
                  AgentRuntimeSlotRepository.nullIfNoIdentity(o.podUid()),
                  s.OBSERVED_POD_UID.getDataType())));
    }
    @SuppressWarnings("unchecked")
    Table<?> v =
        DSL.values(rows.toArray(new org.jooq.Row9[0]))
            .as(
                "v",
                "agent_user_id",
                "gen",
                "phase",
                "message",
                "cpu",
                "mem",
                "started_at",
                "failed_gen",
                "pod_uid");
    Field<Long> vId = v.field("agent_user_id", Long.class);
    Field<Long> vGen = v.field("gen", Long.class);
    Field<String> vPhase = v.field("phase", String.class);
    Field<String> vMessage = v.field("message", String.class);
    Field<Integer> vCpu = v.field("cpu", Integer.class);
    Field<Long> vMem = v.field("mem", Long.class);
    Field<OffsetDateTime> vStart = v.field("started_at", OffsetDateTime.class);
    Field<Long> vFailedGen = v.field("failed_gen", Long.class);
    Field<String> vUid = v.field("pod_uid", String.class);

    // 받을 행 — 이 위치의 AI, 그리고 정지 보고(STOPPING·STOPPED)를 보낸 꺼진 AI(desired STOP)는 위치와 무관하게(WP-1751). 위치가
    // 바뀐 뒤
    // 옛 위치 runner 의 정지 보고로 「꺼짐」이 되게 하되, 다른 위치의 그 밖의 phase 는 받지 않는다 — 새 Pod 판정·generation·키 정리·계정
    // 사용 시각을 다른 위치 runner 가 흔들지 않게. 이 조건으로만 잠가 읽고(before), UPDATE 는 before 와 맞물려 같은 행만 고친다.
    Set<Long> stopReports = new HashSet<>();
    for (RunnerObservedAgent o : last.values()) {
      if ("STOPPING".equals(o.phase()) || "STOPPED".equals(o.phase())) {
        stopReports.add(o.agentUserId());
      }
    }
    var cur = s.as("cur");
    Condition curAt =
        locatedAt(cur, locationId, isDefault)
            .or(cur.DESIRED.eq(Desired.STOP.name()).and(cur.AGENT_USER_ID.in(stopReports)));
    // 쓰기 전 행 전체를 p_ 접두 칸으로 받는다(WP-2000 — 쓰기 전 판정까지 메모리에서 하려고). UPDATE 와 맞물릴 agent_user_id 는 접두 없이
    // 하나 더.
    List<SelectField<?>> beforeFields = new ArrayList<>();
    beforeFields.add(cur.AGENT_USER_ID);
    for (Field<?> f : cur.fields()) beforeFields.add(f.as("p_" + f.getName()));
    Table<?> before =
        dsl.select(beforeFields)
            .from(cur)
            .where(cur.AGENT_USER_ID.in(last.keySet()))
            .and(curAt)
            .forUpdate()
            .asTable("before");
    Field<Long> beforeId = before.field(cur.AGENT_USER_ID.getName(), Long.class);

    // 정체가 같은 관찰 — 지금 Pod 가 밝힌 정체를 그대로 보는 것이라 시작 시각이 조금 달라도(칸 보고가 대신 적어 둔 근사값) 새 Pod 로
    // 세지 않는다. 보고가 정체를 먼저 받아들인 뒤의 관찰은 같은 Pod 의 정확한 시각이기 때문이다(WP-1968 반려 ⑥ — 관찰과 보고가
    // 엇갈려 상태가 되풀이로 비워지지 않게).
    Condition identitySame =
        vUid.isNotNull().and(s.OBSERVED_POD_UID.isNotNull()).and(s.OBSERVED_POD_UID.eq(vUid));
    // 새 Pod 판정(보고 값이 없으면 그 근거는 보지 않는다) — 예전 건별 문장과 같은 규칙을 보고 값 칸으로 쓴다.
    Condition newPod =
        vPhase
            .eq("STARTING")
            .or(vStart.isNotNull().and(s.STARTED_AT.isDistinctFrom(vStart)).andNot(identitySame))
            .or(
                vGen.isNotNull()
                    .and(s.OBSERVED_GENERATION.isNull().or(s.OBSERVED_GENERATION.lt(vGen))))
            // WP-1968: 보고의 Pod 정체(podUid)가 지난 정체와 다르면 새 Pod — 노드 시계가 어긋나도
            // 시작 시각·generation 없이도 정체로 새 Pod 를 잡아 옛 Pod 의 agent_* 를 지운다.
            // 다만 지난 정체를 아직 모르는 첫 관찰(→uid)은 새 Pod 가 아니다 — 배포 뒤 모든 AI 를 새 Pod 로 봐 상태를 비웠다(WP-1968 반려
            // ⑥).
            .or(
                vUid.isNotNull()
                    .and(s.OBSERVED_POD_UID.isNotNull())
                    .and(s.OBSERVED_POD_UID.ne(vUid)));
    // AI 보고가 새 Pod 시작 뒤에 왔으면 새 Pod 의 보고라 지우지 않는다.
    Condition reportedByNewPod =
        vStart.isNotNull().and(s.AGENT_REPORTED_AT.isNotNull()).and(s.AGENT_REPORTED_AT.ge(vStart));
    newPod = newPod.andNot(reportedByNewPod);

    List<SelectField<?>> returning = new ArrayList<>(List.of(s.fields()));
    // 쓴 뒤 값(s 칸)에 이어 쓰기 전 값(p_* 칸)도 같은 RETURNING 으로 받는다.
    for (Field<?> f : before.fields()) {
      if (f.getName().startsWith("p_")) returning.add(f);
    }
    Map<Long, ObservedUpdate> out = new LinkedHashMap<>();
    dsl.update(s)
        .set(s.OBSERVED_GENERATION, DSL.greatest(s.OBSERVED_GENERATION, vGen))
        // WP-2019 실패 generation 은 GREATEST 가 아니라 보고 값 그대로 — runner 가 기록을 지우면 null 로 같이 지워져야 옛 실패가
        // 남지 않는다.
        .set(s.FAILED_GENERATION, vFailedGen)
        .set(s.PHASE, vPhase)
        .set(s.OBSERVED_MESSAGE, vMessage)
        .set(s.CPU_MILLICORES, vCpu)
        .set(s.MEMORY_BYTES, vMem)
        .set(s.STARTED_AT, vStart)
        // WP-1968: 지금 관찰한 Pod 정체를 적는다 — 보고에 없으면(옛 runner) 지난 값을 그대로 둔다(coalesce 와 같은 뜻). 달라질 때만
        // 지금 정체를 갈아끼우고, 지난 정체는 다음 칸으로 미룬다 — 관찰이 끝나는 중인 옛 Pod 를 늦게 봐 지금 정체를 되돌리지 않게(WP-1968 반려 ②).
        .set(s.OBSERVED_POD_UID, observedPodUid(vUid, s))
        .set(s.PREVIOUS_POD_UID, previousPodUid(vUid, s))
        // WP-1958 새 started_at 이 null 이 아니고 보고한 값보다 늦을 때만 비운다.
        // null·옛 Pod 관찰이 새 Pod 가 올린 값을 지우면 안 된다.
        // 여유가 없으면 초 단위로 내린 보고값을 관찰마다 비우고 다음 보고가 다시 올린다.
        // started_at 이 바뀐 것만으로 비우면 낡은 관찰이나 새 Pod 자신의 startTime 이 새 Pod 의 보고값을 지운다.
        .set(
            s.REPORTED_POD_STARTED_AT,
            clearedIf(
                s.REPORTED_POD_STARTED_AT.lt(AgentRuntimeSlotRepository.podStartCutoff(vStart)),
                s.REPORTED_POD_STARTED_AT))
        .set(s.OBSERVED_AT, OffsetDateTime.now())
        .set(s.AGENT_STATE, clearedIf(newPod, s.AGENT_STATE))
        .set(s.AGENT_ISSUE_KEY, clearedIf(newPod, s.AGENT_ISSUE_KEY))
        .set(s.AGENT_ISSUE_KEYS, clearedIf(newPod, s.AGENT_ISSUE_KEYS))
        .set(s.AGENT_NEXT_CHECK_AT, clearedIf(newPod, s.AGENT_NEXT_CHECK_AT))
        .set(s.AGENT_REPORTED_AT, clearedIf(newPod, s.AGENT_REPORTED_AT))
        .from(v, before)
        .where(s.AGENT_USER_ID.eq(vId))
        // 받을 행은 before(위 curAt 으로 잠가 읽은 행)가 정한다 — 잠근 행이라 그 사이 조건이 바뀌지 않는다.
        .and(s.AGENT_USER_ID.eq(beforeId))
        // 지난 정체의 관찰(지금 정체와 다른 옛 Pod 를 늦게 본 것)은 아예 받지 않는다 — 정체를 갈아끼우지도, 그 옛 Pod 의 시작
        // 시각·phase·agent_* 를 지금 Pod 로 덮지도 않는다. 지금 정체를 아직 모르던 첫 관찰(→)은 여기 걸리지 않는다(WP-1968 반려 ②).
        .andNot(staleObservation(vUid, vPhase, vStart, s))
        .returningResult(returning)
        .fetch()
        .forEach(
            r -> {
              Row row = map(r);
              out.put(row.agentUserId(), new ObservedUpdate(row, map(beforeRecord(s, before, r))));
            });
    return out;
  }

  /**
   * RETURNING 레코드에서 쓰기 전 값(p_* 칸)만 원래 칸 이름의 레코드로 옮긴다(WP-2000). {@link #map} 이 같은 칸 이름을 읽으므로 이 레코드를
   * map 하면 쓰기 전 행이 된다 — RETURNING 레코드를 그대로 map 하면 쓴 뒤 값이 읽혀 전 = 후가 된다.
   */
  private Record beforeRecord(
      com.workplace.jooq.tables.AgentRuntimeSetting s, Table<?> before, Record returned) {
    Record out = dsl.newRecord(s);
    for (Field<?> f : s.fields()) copyField(out, f, returned.get(before.field("p_" + f.getName())));
    return out;
  }

  /**
   * 레코드의 한 칸에 값을 옮긴다(WP-2000) — RETURNING 이 돌려준 값은 칸 타입을 모르는 {@code Object} 라 칸 데이터 타입으로 변환해 넣는다.
   * 와일드카드 필드를 타입 매개변수 하나로 묶어 형 변환 없이 옮기려고 따로 뒀다.
   */
  private static <T> void copyField(Record to, Field<T> field, Object value) {
    to.set(field, field.getDataType().convert(value));
  }

  /** {@code when} 이면 NULL, 아니면 지금 값 그대로. */
  private static <T> Field<T> clearedIf(Condition when, Field<T> column) {
    return DSL.when(when, DSL.castNull(column.getDataType())).otherwise(column);
  }

  /**
   * 관찰 보고로 바뀐 지금 Pod 정체(WP-1968 반려 ①) — 보고에 정체가 없으면 지난 값, 아직 몰랐으면 처음 보는 값, 같으면 그대로, 다르면 갈아끼운다. 지난
   * 정체를 늦게 보는 관찰은 WHERE 에 걸러져 여기까지 오지 않는다.
   */
  private static Field<String> observedPodUid(Field<String> vUid, AgentRuntimeSetting s) {
    return DSL.when(vUid.isNull(), s.OBSERVED_POD_UID)
        .when(s.OBSERVED_POD_UID.isNull(), vUid)
        .when(vUid.eq(s.OBSERVED_POD_UID), s.OBSERVED_POD_UID)
        .otherwise(vUid);
  }

  /** 바로 앞 Pod 정체(WP-1968 반려 ①·②) — 지금 정체가 바뀔 때만 미루고, 지금 정체와 같거나 보고가 없으면 그대로. */
  private static Field<String> previousPodUid(Field<String> vUid, AgentRuntimeSetting s) {
    return DSL.when(vUid.isNull(), s.PREVIOUS_POD_UID)
        .when(s.OBSERVED_POD_UID.isNull(), s.PREVIOUS_POD_UID)
        .when(vUid.eq(s.OBSERVED_POD_UID), s.PREVIOUS_POD_UID)
        .otherwise(s.OBSERVED_POD_UID);
  }

  /**
   * 지난 정체의 관찰인지(WP-1968 반려 ②·2차 반려 ①·3차 반려 ①②) — 지금 정체를 아는 상태에서 정체가 다른 관찰이 ① 보고 정체가 바로 앞 정체일 때(끝나는
   * 중인 옛 Pod 를 늦게 본 것), ② 시작 시각이 지금 알던 Pod 시작보다 시계 차이 여유({@link
   * AgentRuntimeSlotRepository#isOlderPod} 와 같은 30초)만큼 넘게 이른 때(두 세대 넘게 지연된 옛 Pod), ③ 끝나는 중
   * phase(STOPPING·STOPPED)이거나 (FAILED 면서 관찰한 시작 시각이 있어 지금 알던 시작보다 이르지 않은 — 새로 뜬 Pod 이 아닌 — 경우)면 지난
   * 것이다. 네 경우 모두 지금 Pod 의 정체·시각·agent_* 를 되돌리지 않으므로 UPDATE 자체에서 뺀다.
   *
   * <p>①·②·③ 은 previous 가 비어 있어도 걸린다(2차 반려 ①) — 배포 직후 observed 가 NULL 일 때 새 Pod B 가 ADOPT 로 정체를
   * 채우면(previous 는 비어 있고 시작 시각만 B 의 것으로 바뀐다)끝나는 중인 옛 Pod A 관찰이 ① 에 걸리지 않아 통과해,
   * observed=A·previous=B 로 뒤집힌다. 그러면 B 의 보고는 영영 OTHER(상태 버림·칸 409 무한)이고 B 관찰은 previous=B 라 ① 로 걸려
   * 회복되지 않는다.
   *
   * <p>FAILED 는 관찰한 시작이 지금 알던 시작보다 뒤(새로 뜬 Pod)일 때만 지난 정체로 보지 않는다(3차 반려 ①) — 처음 관찰될 때 이미 실패한 새
   * Pod(ImagePullBackOff 등)의 관찰이 매번 버려져 「오류」가 화면에 안 뜬다. 지금 Pod 시작이 비어 있으면(끝나는 중 STOPPED 관찰이 지운 경우 —
   * 정체는 남고 시각만 비어 있다) 견딜 기준이 없으므로 뒤인지 아닌지 가를 수 없어 받아들인다(4차 반려) — 기준 없음을 옛 Pod 로 단정하면, 꺼졌다 켠 AI 의 첫
   * 관찰이 이미 FAILED 인 동안 「오류」가 영영 화면에 안 뜬다. 반대로 그보다 이르거나 같은 FAILED 관찰은 끝나는 중인 옛 Pod 로 보아 previous 가
   * 비어 있어도 지난 것이다 — 배포 직후 observed 가 비어 있을 때 옛 Pod A 의 FAILED 관찰이 통과하면 observed=A 로 뒤집혀 지금 Pod B 의
   * 보고가 영영 OTHER 로 남기 때문이다(2차 반려 ① 교착 창). 다만 관찰한 시작 시각이 없으면(vStart null) ③ 을 쓰지 않는다(6차 반려 ③) — 정체가
   * 다르고 시작 시각이 없는 FAILED 관찰을 지난 것으로 버리면 그 실패가 화면에 계속 안 뜬다. 그 경우 지난 여부는 ①(previous 정체)만 본다 — 시각을 견줘
   * 이르지 않은 것만 골라낼 수 있기 때문이다.
   *
   * <p>② 의 여유(30초)는 일부러 넓은 판정이다 — 지금 알던 시작보다 30초 안에 이른 정체가 다른 관찰은 지금 Pod 로 받아 정체를 갈아끼운다. 죽은 빠른 시계
   * Pod 가 올려 둔 기준보다 조금 이른 새 Pod 관찰이 지난 것으로 걸려, 관찰이 정체를 밝히는 회복 경로(약 60초)가 막히지 않게 하려는 선택이다.
   *
   * <p>기준 없음으로 받는 대가도 있다 — 정체가 다른 FAILED 관찰을 그대로 받아 정체를 갈아끼우면(previous 가 지금 정체로 밀려나)방금까지 지금으로 보던 그
   * Pod 의 보고가 잠시 OTHER 로 거절된다. 관찰에 시작 시각이 없는 FAILED 는 정체 불일치·previous 불일치여도 받아들인다(6차 반려 ③) — 그 실패를
   * 지난 옛 Pod 로 단정해 버리면 「오류」가 화면에 영영 안 뜬다.
   *
   * <p>다만 그 뒤에 스스로 회복하지 못하는 한이 남는다 — 받아들인 관찰이 실제로는 **끝나는 죽은 Pod 의 마지막 FAILED 관찰**이어 정체가 스왑되면
   * (observed=그 죽은 Pod, previous=살아 있는 Pod)살아 있는 Pod 의 다음 관찰은 ①(previous 정체)에 걸려 계속 버려져 되돌아오지 않는다.
   * 그때 우회는 미적중 generation 이 남아 있어 Pod 가 다시 생기는 경우(이름이 고정이라 곧 재시작)뿐이고, Pod 이름이 고정이라 신구 동시 존재가 없어 걸리는
   * 자리는 관찰 주기·informer lag 창뿐이다(6차 반려 ③). 「오류」가 영영 안 뜨는 것보다 낮은 확률의 영구 스왑이 낫다고 본 선택이다 — 스왑을 스스로 풀려면
   * observed·previous 갱신에 별도 재정렬 감지가 필요하다(남은 위험).
   *
   * <p>정체가 같은 관찰(첫 인식·근사한 시작 시각)은 위에서 걸러지므로 시작 시각 비교의 영향을 받지 않는다.
   *
   * @param vUid 관찰이 실은 Pod 정체
   * @param vPhase 관찰한 phase
   * @param vStart 관찰한 Pod 시작 시각
   * @param s 갱신할 설정 행(지금 정체·바로 앞 정체·지금 Pod 시작)
   */
  private static Condition staleObservation(
      Field<String> vUid,
      Field<String> vPhase,
      Field<OffsetDateTime> vStart,
      AgentRuntimeSetting s) {
    Condition differentIdentity =
        vUid.isNotNull().and(s.OBSERVED_POD_UID.isNotNull()).and(s.OBSERVED_POD_UID.ne(vUid));
    Condition previousIdentity = s.PREVIOUS_POD_UID.isNotNull().and(s.PREVIOUS_POD_UID.eq(vUid));
    // 3차 반려 ②: 메모리 판정 isOlderPod 와 같은 30초 시계 차이 여유를 쓴다 — 여유 없이 비교하면 부풀려진 기준(죽은 빠른 시계 Pod 가 올린 값)보다
    // 조금 이른 새 Pod 관찰이 지난 정체로 걸려 관찰이 정체를 밝히는 회복 경로가 막힌다.
    Field<OffsetDateTime> olderThan =
        DSL.field(
            "{0} - make_interval(secs => {1})",
            OffsetDateTime.class,
            s.STARTED_AT,
            DSL.val(AgentRuntimeSlotRepository.POD_START_CLOCK_SKEW_GRACE.toSeconds() / 1.0));
    Condition olderPod = vStart.isNotNull().and(s.STARTED_AT.isNotNull()).and(vStart.lt(olderThan));
    Condition endingPhase = vPhase.isNotNull().and(vPhase.in("STOPPING", "STOPPED"));
    // 3차 반려 ①: FAILED 는 관찰한 시작이 지금 알던 시작보다 뒤(새로 뜬 Pod)일 때만 지난 정체로 보지 않는다 — 위 javadoc 의 교착 창 때문이다.
    // 4차 반려: 지금 Pod 시작이 비어 있으면(끝나는 중 STOPPED 관찰이 시각만 비운 경우) 뒤인지 가를 수 없어 받아들인다 — 기준 없음을 옛 Pod 로
    // 단정하면 꺼졌다 켠 AI 의 첫 관찰이 이미 FAILED 인 동안 「오류」가 영영 화면에 안 뜬다.
    Condition newerStart =
        vStart.isNotNull().and(s.STARTED_AT.isNull().or(vStart.gt(s.STARTED_AT)));
    // 6차 반려 ③: 관찰에 시작 시각이 없으면(vStart null) 정체가 다른 FAILED 를 지난 정체로 단정하지 않는다 — 지난 것으로 보면 「오류」가
    // 화면에 계속 안 뜬다. 이 경우 지난 여부는 previous 정체일 때(①)만 본다 — 아래 반환에서 previousIdentity 가 그대로 남아 있기 때문이다.
    // 시각이 있는 FAILED 만 끝나는 중 판정에 쓴다(시각을 견줘 이르지 않은 것만 골라낼 수 있다).
    Condition failedEnding =
        vPhase.isNotNull().and(vPhase.eq("FAILED")).andNot(newerStart).and(vStart.isNotNull());
    return differentIdentity.and(previousIdentity.or(olderPod).or(endingPhase).or(failedEnding));
  }

  /**
   * 보고가 처음 밝힌 Pod 정체를 지금 Pod 로 받아들인다(WP-1968 반려 ①) — runner 관찰(약 60초)을 기다리지 않고, 재시작 직후 새 Pod 의 첫
   * 보고가 {@link PodIdentity#OTHER} 로 버려지지 않게 한다. 지금 정체가 이미 있던(진짜 재시작인) 경우에만 바로 앞 정체를 갈아끼우고, 아직 없던 첫
   * 인식은 {@code previous} 를 비운 채 쓴다 — 배포 뒤 첫 보고를 새 Pod 로 오판해 상태를 비우지 않기 때문이다(WP-1968 반려 ⑥).
   *
   * <p>보고에 시작 시각이 있으면 지금 Pod 시작({@link Row#startedAt})과 기준({@link Row#reportedPodStartedAt})을 그 값으로
   * 고쳐, 끝나는 중인 옛 Pod 가 올려 둔 높은 시각이 남아 새 Pod 의 보고·차단이 옛 Pod 로 오판되지 않는다(WP-1968 반려 ②·④). 시각이 없으면 기존
   * 값을 그대로 두고 다음 관찰이 고친다. 호출자가 이 행을 이미 잠겼다고 가정한다({@link #findForUpdate}).
   *
   * @param before 잠긴 설정 행 — 지금까지 알던 정체와 사용자 id 를 읽는다
   * @param podUid 보고가 밝힌 정체
   * @param podStartedAt 보고한 Pod 시작 시각(시계 이상이 이미 걸러진 값 — {@link
   *     AgentRuntimeSlotRepository#acceptedPodStart})
   * @return 받아들인 뒤의 행(뒤의 판정·합치기가 이 행 기준으로 잇게)
   */
  public Row adoptPodIdentity(Row before, String podUid, OffsetDateTime podStartedAt) {
    var s = AGENT_RUNTIME_SETTING;
    return dsl.update(s)
        .set(s.PREVIOUS_POD_UID, before.observedPodUid())
        .set(s.OBSERVED_POD_UID, podUid)
        .set(
            s.STARTED_AT,
            podStartedAt == null ? s.STARTED_AT : DSL.val(podStartedAt, s.STARTED_AT.getDataType()))
        .set(
            s.REPORTED_POD_STARTED_AT,
            podStartedAt == null
                ? s.REPORTED_POD_STARTED_AT
                : DSL.val(podStartedAt, s.REPORTED_POD_STARTED_AT.getDataType()))
        .where(s.AGENT_USER_ID.eq(before.agentUserId()))
        .returning()
        .fetchOne(this::map);
  }

  /**
   * 칸별 보고를 합친 AI 상태를 agent_* 칸에 쓴다(WP-1409) — 상태(null 허용 — 살아 있는 칸이 없으면 보고 없음)·현재 이슈 키(목록의 첫 키, 옛
   * 화면·옛 인스턴스 호환)·현재 이슈 키 목록·다음 확인 시각·보고 시각만 고친다. 원하는 상태 칸·generation·runner 관찰 칸·updated_at 은 건드리지
   * 않는다(보고는 설정 변경이 아니다). 보고 시각은 지금 Pod 가 뜨기 전의 보고를 적용 판정에서 거르는 기준이다(WP-1253). 합치기 규칙(서비스 계층)에 기대지
   * 않도록 값만 받는다.
   *
   * <p>호출자가 이 행을 이미 잠갔다고 가정한다({@link #findForUpdate} 또는 관찰 보고의 UPDATE) — 설정 행 → 칸 테이블 순으로 잠가, 칸
   * 쓰기·읽기· 합치기·이 쓰기가 한 줄로 서서 두 칸이 동시에 보고해도 합친 값이 어긋나지 않게.
   *
   * @param issueKeys 현재 이슈 키 목록(칸 키 순) — 첫 키를 agent_issue_key 에도 쓴다
   * @param reportedAt 합친 칸의 마지막 보고 시각 — 뜻은 {@code AgentSlotAggregate#latestReportedAt}(WP-1969)
   * @return 쓴 뒤 행
   */
  public Row writeAgentState(
      long agentUserId,
      AgentState state,
      List<String> issueKeys,
      OffsetDateTime nextCheckAt,
      OffsetDateTime reportedAt) {
    var s = AGENT_RUNTIME_SETTING;
    return dsl.update(s)
        .set(s.AGENT_STATE, state == null ? null : state.name())
        .set(s.AGENT_ISSUE_KEY, issueKeys.isEmpty() ? null : issueKeys.get(0))
        .set(s.AGENT_ISSUE_KEYS, issueKeys.toArray(new String[0]))
        .set(s.AGENT_NEXT_CHECK_AT, nextCheckAt)
        .set(s.AGENT_REPORTED_AT, reportedAt)
        .where(s.AGENT_USER_ID.eq(agentUserId))
        .returning()
        .fetchOne(this::map);
  }

  /**
   * 진입점이 보고한 칸 차단 사실·이유를 쓴다(WP-1913) — 실행 설정이 없는 AI 는 부르지 않는다(호출자가 잠금·존재 확인). message 가 null 이면 세 칸
   * 모두 비운다(다시 띄웠다는 OK 보고). runner 관찰 칸·원하는 상태 칸·agent_* 칸은 건드리지 않는다 — 진입점 보고와 runner 보고는 다른 칸에 남겨
   * 두고 읽을 때만 합친다(덮어쓰기 없음). 호출자가 이 행을 이미 잠겼다고 가정한다({@link #findForUpdate}).
   *
   * @param message 차단 이유(최대 500자 — DTO 에서 검증) 또는 null(칸 비움)
   * @param at 차단을 보고한 시각 — message 가 null 이면 함께 지운다
   * @param podStartedAt 그 사유를 보고한 Pod 의 시작 시각(WP-1958, 보고에 없으면 null) — message 가 null 이면 함께 지운다.
   *     끝나는 중인 옛 Pod 의 늦은 보고가 새 Pod 의 차단 사유를 덮지 않게 서비스가 비교한다
   * @param generation 그 사유를 보고한 Pod 의 generation — null(보고에 없음)도 그대로 남긴다. 지금 generation 과 다른 값을 들고
   *     있는 보고는 서비스가 이 메서드를 부르기 전에 걸러 낸다(끝나는 중인 옛 Pod 의 늦은 보고가 새 generation 을 덮지 않게 — 예외는 {@code
   *     AgentPaneReportService#acceptableGeneration}, WP-1969)
   */
  public void updatePaneBlocked(
      long agentUserId,
      String message,
      OffsetDateTime at,
      Long generation,
      OffsetDateTime podStartedAt) {
    var s = AGENT_RUNTIME_SETTING;
    OffsetDateTime savedAt = message == null ? null : at;
    dsl.update(s)
        .set(s.PANE_BLOCKED_MESSAGE, message)
        .set(s.PANE_BLOCKED_AT, savedAt)
        .set(s.PANE_BLOCKED_GENERATION, message == null ? null : generation)
        .set(s.PANE_BLOCKED_POD_STARTED_AT, message == null ? null : podStartedAt)
        .where(s.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  /**
   * 보고가 알려 준 Pod 시작 시각을 올린다(WP-1958) — {@code GREATEST} 한 문장이라 올라가기만 하고(Postgres GREATEST 는 NULL 을
   * 무시해 첫 값도 들어간다) 동시 보고가 내려 쓰지 않는다. null 이면 아무것도 하지 않는다. runner 관찰이 새 Pod 를 아직 못 봤을 때 지금 Pod 시작의
   * 근거가 된다.
   */
  public void raiseReportedPodStart(long agentUserId, OffsetDateTime podStartedAt) {
    if (podStartedAt == null) return;
    var s = AGENT_RUNTIME_SETTING;
    dsl.update(s)
        .set(
            s.REPORTED_POD_STARTED_AT,
            DSL.greatest(s.REPORTED_POD_STARTED_AT, DSL.val(podStartedAt)))
        .where(s.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  /**
   * 보고가 알려 준 Pod 시작 시각을 **그대로** 쓴다(WP-1968) — 정체가 관찰 정체와 같은 보고의 값은 지금 Pod 기준이라 max({@link
   * #raiseReportedPodStart})로 올리면 안 된다. 빠른 시계를 가진 죽은 Pod 가 올려 둔 높은 값이 남으면 새 Pod 의 시작 시각이 옛 Pod 로
   * 오판되어 새 Pod 의 보고가 영영 거절된다. 값이 이전 기준보다 낮아도 내려 덮어쓰고, null 을 넘기면 칸을 비운다 — 다만 지금 호출자({@link
   * #refreshReportedPodStart})는 보고에 시각이 없으면 아예 이 메서드를 부르지 않아 기존 기준이 그대로다. 호출자가 이 행을 이미 잠겼다고
   * 가정한다({@link #findForUpdate}).
   */
  public void setReportedPodStart(long agentUserId, OffsetDateTime podStartedAt) {
    var s = AGENT_RUNTIME_SETTING;
    dsl.update(s)
        .set(s.REPORTED_POD_STARTED_AT, podStartedAt)
        .where(s.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  /**
   * 이번 보고로 기준(reported_pod_started_at)을 갱신하고 갱신 뒤의 기준을 돌려준다(WP-1968) — 상태·칸 두 보고가 같은 규칙으로 기준을 다루도록
   * 한 곳에 모았다.
   *
   * <p>정체가 같은 보고({@link PodIdentity#MATCH})의 시각은 지금 Pod 기준이라 기준을 그 값으로 내려 덮어쓴다 — 올리기만 하는 {@link
   * #raiseReportedPodStart} 를 쓰면 시계 차이 여유({@link
   * AgentRuntimeSlotRepository#POD_START_CLOCK_SKEW_GRACE}) 안에서 올라간 높은 기준이 남아 같은 정체의 다음 보고가 옛 Pod 로
   * 오판되기 때문이다. 기준보다 여유를 넘게 이른 보고는 두 보고 서비스가 이 메서드를 부르기 전에 이미 거절하므로(5차 반려 ② — 정체가 같아도 시각 비교), 여기서 내려
   * 덮는 값은 기준과 여유 안에서만 어긋난다. 보고에 시각이 없으면 기존 기준을 그대로 두고 비우지 않는다.
   *
   * <p>돌려준 값은 이 보고 뒤의 기준 — 화면·합치기가 쓰는 지금 Pod 시작 계산의 근거다. 덮어쓴 뒤에도 옛 기준과 max 로 합치면 정체가 같은 보고의 결과가 옛
   * Pod 로 오판된다: 칸 차단 보고에서는 지금 Pod 의 차단이 화면에 안 보여 알림이 빠지고, 상태 보고에서는 같은 정체의 형제 칸이 매 보고에서 지워진다. 호출자가 이
   * 행을 이미 잠겼다고 가정한다({@link #findForUpdate}).
   *
   * @param before 잠긴 설정 행 — agentUserId 와 이전 기준을 읽는다
   * @param identity 보고 정체 판정({@link AgentRuntimeSlotRepository#podIdentity})
   * @param podStartedAt 보고한 Pod 시작 시각(시계 이상이 이미 걸러진 값 — {@link
   *     AgentRuntimeSlotRepository#acceptedPodStart}), null 이면 기준을 만지지 않는다
   * @return 갱신 뒤의 기준
   */
  public OffsetDateTime refreshReportedPodStart(
      Row before, PodIdentity identity, OffsetDateTime podStartedAt) {
    // 정체가 같은 보고는 지금 Pod 기준 — 기준을 보고 값으로 내려 덮고 그 값을 그대로 돌려준다.
    if (identity == PodIdentity.MATCH && podStartedAt != null) {
      setReportedPodStart(before.agentUserId(), podStartedAt);
      return podStartedAt;
    }
    // 정체가 같지 않은 보고(정체를 모르는 옛 이미지 — UNKNOWN)는 지금처럼 기준을 올리기만 한다.
    // 시계 이상이라 걸러진 값이나 없는 값은 기준을 만지지 않는다.
    if (podStartedAt != null
        && (before.reportedPodStartedAt() == null
            || podStartedAt.isAfter(before.reportedPodStartedAt()))) {
      raiseReportedPodStart(before.agentUserId(), podStartedAt);
    }
    return AgentRuntimeSlotRepository.laterOf(before.reportedPodStartedAt(), podStartedAt);
  }

  /**
   * 새 설정 — generation 1·desired STOP·apply_mode IDLE(컬럼 기본값). 넣은 행을 돌려준다(전이 모양을 컬럼 기본값에서 읽게).
   *
   * @param launched 지금 이 generation 을 띄울 버전(WP-1706). null 이면 기록 칸을 비워 둔다.
   */
  public Row insert(
      long agentUserId,
      String templateName,
      String templateVersion,
      Long locationId,
      Map<String, String> config,
      RuntimeVersion launched,
      long updatedBy) {
    return dsl.insertInto(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.AGENT_USER_ID, agentUserId)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, templateName)
        .set(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION, templateVersion)
        .set(AGENT_RUNTIME_SETTING.LOCATION_ID, locationId)
        .set(AGENT_RUNTIME_SETTING.CONFIG, writeConfig(config))
        .set(AGENT_RUNTIME_SETTING.RUNTIME_IMAGE, launched == null ? null : launched.image())
        .set(
            AGENT_RUNTIME_SETTING.RUNTIME_PLUGIN_VERSION,
            launched == null ? null : launched.pluginVersion())
        .set(AGENT_RUNTIME_SETTING.UPDATED_BY, updatedBy)
        .returning()
        .fetchOne(this::map);
  }

  /**
   * 원하는 상태 칸을 {@code next} 로 덮어쓴다(호출자가 바뀐 경우에만 부르고 generation 을 올려 넘긴다). 관찰 칸은 건드리지 않는다.
   *
   * @param launched 이 generation 이 띄울 버전(WP-1706) — 있으면 기록 칸을 갱신한다(플러그인 버전을 모르면 기존 값을 지키고, 이미지는 늘
   *     갱신). null 이면(generation 을 올리지 않는 변경) 두 칸 그대로.
   */
  public void update(Row next, Long updatedBy) {
    update(next, updatedBy, null);
  }

  /** 위 {@link #update(Row, Long)} 에 이 generation 이 띄울 버전 기록을 더한 형태. */
  public void update(Row next, Long updatedBy, RuntimeVersion launched) {
    UpdateSetMoreStep<AgentRuntimeSettingRecord> update =
        dsl.update(AGENT_RUNTIME_SETTING)
            .set(AGENT_RUNTIME_SETTING.TEMPLATE_NAME, next.templateName())
            .set(AGENT_RUNTIME_SETTING.TEMPLATE_VERSION, next.templateVersion())
            .set(AGENT_RUNTIME_SETTING.LOCATION_ID, next.locationId())
            .set(AGENT_RUNTIME_SETTING.CONFIG, writeConfig(next.config()))
            .set(AGENT_RUNTIME_SETTING.DESIRED, next.desired().name())
            .set(AGENT_RUNTIME_SETTING.APPLY_MODE, next.applyMode().name())
            .set(AGENT_RUNTIME_SETTING.GENERATION, next.generation())
            .set(AGENT_RUNTIME_SETTING.ACCEPT_NEW_WORK, next.acceptNewWork())
            .set(
                AGENT_RUNTIME_SETTING.SLOT_LIMIT,
                next.slotLimit() == null ? null : next.slotLimit().shortValue())
            .set(AGENT_RUNTIME_SETTING.UPDATED_BY, updatedBy)
            .set(AGENT_RUNTIME_SETTING.UPDATED_AT, OffsetDateTime.now());
    withLaunched(update, launched)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(next.agentUserId()))
        .execute();
  }

  /** 기록된 버전(WP-1706) — 테스트·로그용 읽기. 두 칸이 모두 null 이면(기록 없음) empty. */
  public Optional<RuntimeVersion> findRuntimeVersion(long agentUserId) {
    return dsl.select(
            AGENT_RUNTIME_SETTING.RUNTIME_IMAGE, AGENT_RUNTIME_SETTING.RUNTIME_PLUGIN_VERSION)
        .from(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .fetchOptional()
        .filter(r -> r.value1() != null || r.value2() != null)
        .map(r -> new RuntimeVersion(r.value1(), r.value2()));
  }

  /**
   * 띄운 버전 기록 칸(이미지·플러그인 버전)의 UPDATE 값 모음(WP-1706) — 기록하는 모든 UPDATE 가 이 규칙 하나를 쓴다. 이미지는 늘 갱신, 플러그인
   * 버전은 {@link #pluginVersionValue} 규칙.
   */
  private static Map<Field<?>, Object> launchedFields(RuntimeVersion v) {
    return Map.of(
        AGENT_RUNTIME_SETTING.RUNTIME_IMAGE, v.image(),
        AGENT_RUNTIME_SETTING.RUNTIME_PLUGIN_VERSION, pluginVersionValue(v));
  }

  /** {@code launched} 가 있으면 기록 칸을 UPDATE 에 더하고, null 이면(generation 을 올리지 않는 변경) 그대로 돌려준다. */
  private static UpdateSetMoreStep<AgentRuntimeSettingRecord> withLaunched(
      UpdateSetMoreStep<AgentRuntimeSettingRecord> update, RuntimeVersion launched) {
    return launched == null ? update : update.set(launchedFields(launched));
  }

  /** 기록할 플러그인 버전 값(WP-1706) — 모르면(null) 기존 값을 지킨다(coalesce). 기록하는 모든 UPDATE 가 같은 규칙을 쓰게 한 곳에 둔다. */
  private static Field<String> pluginVersionValue(RuntimeVersion v) {
    return DSL.coalesce(
        DSL.val(v.pluginVersion(), AGENT_RUNTIME_SETTING.RUNTIME_PLUGIN_VERSION),
        AGENT_RUNTIME_SETTING.RUNTIME_PLUGIN_VERSION);
  }

  /**
   * 기록된 버전이 지금 버전과 다른 행 조건(WP-1706) — 기록이 없으면(null) 다르다고 본다. 플러그인 버전을 모르면(null) 이미지만 견준다 — 배포가 플러그인
   * 버전을 안 넘길 때 기록된 값을 지우거나 헛되이 올리지 않게. 올리기·기록만 하기가 같은 판정을 쓰도록 한 곳에 둔다.
   */
  private static Condition differsFrom(RuntimeVersion current) {
    Condition imageDiffers = AGENT_RUNTIME_SETTING.RUNTIME_IMAGE.isDistinctFrom(current.image());
    if (current.pluginVersion() == null) return imageDiffers;
    return imageDiffers.or(
        AGENT_RUNTIME_SETTING.RUNTIME_PLUGIN_VERSION.isDistinctFrom(current.pluginVersion()));
  }

  /**
   * 릴리스로 버전이 바뀐 켜진 AI 의 generation 을 올린다(WP-1706) — 한 문장 {@code UPDATE … RETURNING}. 그 템플릿에서 켜져
   * 있고(desired RUN) 한 번이라도 떴으며(observed_generation 있음) 기록 버전이 지금과 다른 행만 올린다. apply_mode 는 {@link
   * #bumpGenerationForRotation} 과 같게 대기 중 NOW 면 NOW 를 지키고 아니면 IDLE(쉴 때 적용).
   * updated_by·updated_at·설정은 건드리지 않는다 — 시스템이 올린 변경이 「누가 언제 바꿨는지」를 지우지 않게.
   *
   * <p>기록 ≠ 지금을 WHERE 에 두어 파드 여럿이 동시에 불러도 한 번만 올린다 — 뒤 UPDATE 는 앞 트랜잭션의 행 잠금을 기다렸다가 커밋된 행으로 WHERE 를
   * 다시 평가해 건너뛴다.
   *
   * @return 올린 행(올린 쪽만 알림을 내게)
   */
  public List<Row> bumpForRuntimeVersion(String templateName, RuntimeVersion current) {
    var s = AGENT_RUNTIME_SETTING;
    Condition pendingNow = s.APPLY_MODE.eq(ApplyMode.NOW.name()).and(UNAPPLIED_GENERATION);
    Condition target =
        s.TEMPLATE_NAME
            .eq(templateName)
            .and(s.DESIRED.eq(Desired.RUN.name()))
            .and(s.OBSERVED_GENERATION.isNotNull())
            .and(differsFrom(current));
    // 대상 행을 id 순으로 먼저 잠근다(WP-1706) — 파드 여럿이 동시에 여러 행을 올릴 때 잠금 순서가 갈려 교착하지 않게. 같은 트랜잭션 안에서 부른다.
    dsl.select(s.AGENT_USER_ID).from(s).where(target).orderBy(s.AGENT_USER_ID).forUpdate().fetch();
    return dsl.update(s)
        .set(s.GENERATION, s.GENERATION.plus(1))
        .set(
            s.APPLY_MODE,
            DSL.when(pendingNow, ApplyMode.NOW.name()).otherwise(ApplyMode.IDLE.name()))
        .set(launchedFields(current))
        .where(target)
        .returning()
        .fetch(this::map);
  }

  /**
   * 올리지 않을 행의 기록만 지금 버전으로 맞춘다(WP-1706) — 꺼졌거나 첫 기동 전인 행. Pod 가 없거나 막 지금 desired 로 뜨는 중이라 올릴 까닭이 없고,
   * 켤 때·뜰 때 새 버전으로 뜨므로 기록만 따라간다. generation·apply_mode 는 그대로.
   *
   * @return 기록을 고친 행 수
   */
  public int recordRuntimeVersion(String templateName, RuntimeVersion current) {
    var s = AGENT_RUNTIME_SETTING;
    return dsl.update(s)
        .set(launchedFields(current))
        .where(s.TEMPLATE_NAME.eq(templateName))
        .and(s.DESIRED.ne(Desired.RUN.name()).or(s.OBSERVED_GENERATION.isNull()))
        .and(differsFrom(current))
        .execute();
  }

  /**
   * 키 교체용 generation 올리기(WP-1253) — generation +1 과 apply_mode 만 고친다. 관리자가 쓴
   * 칸(updated_by·updated_at·설정)은 그대로 둔다 — 시스템이 올린 교체가 「누가 언제 바꿨는지」를 지우지 않게. 아직 반영되지 않은 바로 적용(NOW)이
   * 걸려 있으면 NOW 를 지킨다. 호출자가 행을 잠근 뒤에 부른다.
   *
   * @param applyMode 걸 적용 시점(대기 중인 NOW 가 있으면 무시하고 NOW)
   * @param launched 이 generation 이 띄울 버전(WP-1706) — null 이면 기록 칸 그대로
   * @return 올린 뒤 generation
   */
  public long bumpGenerationForRotation(
      long agentUserId, ApplyMode applyMode, RuntimeVersion launched) {
    Condition pendingNow =
        AGENT_RUNTIME_SETTING.APPLY_MODE.eq(ApplyMode.NOW.name()).and(UNAPPLIED_GENERATION);
    UpdateSetMoreStep<AgentRuntimeSettingRecord> update =
        dsl.update(AGENT_RUNTIME_SETTING)
            .set(AGENT_RUNTIME_SETTING.GENERATION, AGENT_RUNTIME_SETTING.GENERATION.plus(1))
            .set(
                AGENT_RUNTIME_SETTING.APPLY_MODE,
                DSL.when(pendingNow, ApplyMode.NOW.name()).otherwise(applyMode.name()));
    // generation 을 올리는 저장은 지금 버전을 함께 적는다(WP-1706) — 안 적으면 다음 기동 비교가 낡은 기록으로 또 올린다.
    return withLaunched(update, launched)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .returning(AGENT_RUNTIME_SETTING.GENERATION)
        .fetchOne(AGENT_RUNTIME_SETTING.GENERATION);
  }

  /**
   * 미뤄 둔 generation 을 바로 적용으로 돌린다(WP-1515) — 한 문장으로 여러 AI 를 고친다. 켜져 있고(desired=RUN) 아직 반영하지 않은
   * generation 이 있으며(generation ≠ 관찰 generation) apply_mode 가 NOW 가 아닌 행만 apply_mode=NOW 로 고친다.
   * generation·설정·updated_by 등 다른 칸은 그대로다.
   *
   * <p>바로 적용해야 하는 입력 변경(키 원문 교체·저장소 토큰 교체·기존 연결 등록·회수)이 「쉴 때 적용」으로 미뤄 둔 계정·설정 변경 뒤에 묶여 기다리지 않게 쓴다 —
   * Pod 를 새 토큰으로 띄우려면 어차피 다시 만들어야 하고, 다시 만들면 미뤄 둔 것까지 최신 generation 으로 뜬다. 화면의 「지금 적용」(바뀐 설정 없이 NOW
   * 로 다시 저장)도 이것을 쓴다. 판정 규칙을 SQL 한곳에 두어 호출자가 같은 조건을 되풀이하지 않게 한다.
   *
   * <p>고치는 행을 잠근다 — 호출자는 계정 행을 잠그기 전에 부른다(잠금 순서 설정 행 → 계정 행, {@code AgentAccountBindingService}
   * 참고).
   *
   * @return 실제로 NOW 로 돌린 행 수(대상이 비었거나 미뤄 둔 generation 이 없으면 0)
   */
  public int markPendingApplyNow(Collection<Long> agentUserIds) {
    if (agentUserIds.isEmpty()) return 0;
    return dsl.update(AGENT_RUNTIME_SETTING)
        .set(AGENT_RUNTIME_SETTING.APPLY_MODE, ApplyMode.NOW.name())
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.in(agentUserIds))
        .and(AGENT_RUNTIME_SETTING.DESIRED.eq(Desired.RUN.name()))
        .and(UNAPPLIED_GENERATION)
        .and(AGENT_RUNTIME_SETTING.APPLY_MODE.ne(ApplyMode.NOW.name()))
        .execute();
  }

  public int delete(long agentUserId) {
    return dsl.deleteFrom(AGENT_RUNTIME_SETTING)
        .where(AGENT_RUNTIME_SETTING.AGENT_USER_ID.eq(agentUserId))
        .execute();
  }

  private static JSONB writeConfig(Map<String, String> config) {
    try {
      return JSONB.valueOf(MAPPER.writeValueAsString(config == null ? Map.of() : config));
    } catch (JacksonException e) {
      throw new IllegalStateException("실행 설정을 저장 형식으로 바꾸지 못했습니다", e);
    }
  }

  private static Map<String, String> readConfig(JSONB json) {
    if (json == null || json.data() == null || json.data().isBlank()) return new LinkedHashMap<>();
    try {
      return MAPPER.readValue(json.data(), CONFIG_TYPE);
    } catch (JacksonException e) {
      throw new IllegalStateException("저장된 실행 설정을 읽지 못했습니다", e);
    }
  }
}
