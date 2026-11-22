package com.workplace.agentruntime.repository;

import static com.workplace.jooq.Tables.AGENT_RUNTIME_SLOT_STATE;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.jooq.tables.records.AgentRuntimeSlotStateRecord;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.jooq.DSLContext;
import org.jooq.Field;
import org.jooq.Row3;
import org.jooq.Table;
import org.jooq.impl.DSL;
import org.jooq.types.DayToSecond;
import org.springframework.stereotype.Repository;

/**
 * AI 상태 보고의 칸별 마지막 값(agent_runtime_slot_state) 리포지토리(WP-1409). 칸은 한 Pod 안의 work-loop 하나(프로젝트 키,
 * 대문자)이고 {@code ''} 은 칸을 밝히지 않은 보고(옛 플러그인·외부 구성)다. 테넌트 격리는 RLS + tenant_id GUC DEFAULT 로
 * 보장된다(애플리케이션은 tenant_id 를 넣지 않는다). 실행 설정 행을 지우면 FK CASCADE 로 칸도 사라진다.
 */
@Repository
@RequiredArgsConstructor
public class AgentRuntimeSlotRepository {

  private final DSLContext dsl;

  /**
   * 칸 하나의 마지막 보고.
   *
   * @param slotKey 칸 키(프로젝트 키 대문자, '' = 칸을 밝히지 않은 보고)
   * @param issueKey 그 칸이 처리 중인 이슈 키(없으면 null)
   * @param nextCheckAt 쉬는 칸의 다음 확인 시각(없으면 null)
   * @param reportedAt 서버가 보고를 받은 시각 — Pod 재시작 전 칸을 거르는 기준
   * @param podStartedAt 그 칸 보고를 보낸 Pod 의 시작 시각(WP-1958) — 보고에 없으면 null. 있으면 옛 Pod 판정이 서버가 받은 시각 대신
   *     이 값을 쓴다(끝나는 중인 옛 Pod 의 늦은 보고가 새 Pod 뒤에 도착해도 옛 것으로 가려내려고)
   */
  public record Slot(
      String slotKey,
      AgentState state,
      String issueKey,
      OffsetDateTime nextCheckAt,
      OffsetDateTime reportedAt,
      OffsetDateTime podStartedAt) {}

  /**
   * 칸 보고를 쓴다 — 없으면 넣고 있으면 상태·이슈 키·다음 확인·보고 시각 네 칸을 늘 함께 덮어쓴다(쉬는 중 보고가 옛 이슈 키를 지운다). WP-1958 부터 보고한
   * Pod 시작 시각(pod_started_at)도 늘 덮어쓴다 — 시각 없는 보고가 옛 시각을 남기지 않게. 실행 설정 행이 있어야 한다(FK).
   */
  public void upsert(
      long agentUserId,
      String slotKey,
      AgentState state,
      String issueKey,
      OffsetDateTime nextCheckAt,
      OffsetDateTime reportedAt,
      OffsetDateTime podStartedAt) {
    var t = AGENT_RUNTIME_SLOT_STATE;
    dsl.insertInto(t)
        .set(t.AGENT_USER_ID, agentUserId)
        .set(t.SLOT_KEY, slotKey)
        .set(t.STATE, state.name())
        .set(t.ISSUE_KEY, issueKey)
        .set(t.NEXT_CHECK_AT, nextCheckAt)
        .set(t.REPORTED_AT, reportedAt)
        .set(t.POD_STARTED_AT, podStartedAt)
        .onConflict(t.TENANT_ID, t.AGENT_USER_ID, t.SLOT_KEY)
        .doUpdate()
        .set(t.STATE, state.name())
        .set(t.ISSUE_KEY, issueKey)
        .set(t.NEXT_CHECK_AT, nextCheckAt)
        .set(t.REPORTED_AT, reportedAt)
        .set(t.POD_STARTED_AT, podStartedAt)
        .execute();
  }

  /**
   * 옛 Pod 칸을 가를 때 두는 시계 차이 여유 — 30초. reported_at 은 API 서버 시계, started_at 은 runner·kubelet 시계라 서로 조금
   * 어긋날 수 있다. 새 Pod 칸이 시작 직후 보고했는데 API 시계가 조금 늦어 「Pod 시작 전 보고」로 잘못 지워지지 않게 시작 시각보다 30초 넘게 앞선 보고만 옛
   * Pod 의 것으로 본다(WP-1409).
   */
  public static final Duration POD_START_CLOCK_SKEW_GRACE = Duration.ofSeconds(30);

  /**
   * 그 AI 의 모든 칸 — 순서 없음(정렬은 합치기 {@code AgentSlotAggregate} 가 한 번만 한다). 다른 워크스페이스의 칸은 RLS 로 보이지 않는다.
   */
  public List<Slot> findAll(long agentUserId) {
    var t = AGENT_RUNTIME_SLOT_STATE;
    return dsl.selectFrom(t).where(t.AGENT_USER_ID.eq(agentUserId)).fetch(this::map);
  }

  /**
   * 여러 AI 의 칸을 한 번에 — AI id → 칸들(순서 없음, 칸이 없는 AI 는 빠진다). runner 관찰 보고 묶음을 AI 수와 상관없는 쿼리 수로 처리하려고.
   */
  public Map<Long, List<Slot>> findAllOf(Collection<Long> agentUserIds) {
    if (agentUserIds.isEmpty()) return Map.of();
    var t = AGENT_RUNTIME_SLOT_STATE;
    Map<Long, List<Slot>> out = new LinkedHashMap<>();
    dsl.selectFrom(t)
        .where(t.AGENT_USER_ID.in(agentUserIds))
        .forEach(r -> out.computeIfAbsent(r.getAgentUserId(), k -> new ArrayList<>()).add(map(r)));
    return out;
  }

  private Slot map(AgentRuntimeSlotStateRecord r) {
    return new Slot(
        r.getSlotKey(),
        AgentState.valueOf(r.getState()),
        r.getIssueKey(),
        r.getNextCheckAt(),
        r.getReportedAt(),
        r.getPodStartedAt());
  }

  /**
   * 옛 Pod 칸을 가르는 기준 시각 — Pod 시작 시각에서 {@link #POD_START_CLOCK_SKEW_GRACE} 를 뺀 값. 메모리 거르기({@link
   * #isFromOldPod})와 SQL 지우기({@link #deleteReportedBeforePodStart})가 이 한 곳의 규칙을 함께 쓴다.
   */
  public static OffsetDateTime podStartCutoff(OffsetDateTime podStartedAt) {
    return podStartedAt.minus(POD_START_CLOCK_SKEW_GRACE);
  }

  /** {@link #podStartCutoff(OffsetDateTime)} 의 SQL 판 — UPDATE 안에서 열 값끼리 견줄 때 같은 여유를 쓴다(WP-1958). */
  static Field<OffsetDateTime> podStartCutoff(Field<OffsetDateTime> podStartedAt) {
    return podStartedAt.sub(DayToSecond.valueOf(POD_START_CLOCK_SKEW_GRACE));
  }

  /** 둘 중 null 이 아닌 늦은 시각 — 둘 다 null 이면 null(보고한 Pod 시작 시각을 올리는 계산용, WP-1958). 두 보고 서비스가 함께 쓴다. */
  public static OffsetDateTime laterOf(OffsetDateTime a, OffsetDateTime b) {
    if (a == null) return b;
    if (b == null) return a;
    return a.isAfter(b) ? a : b;
  }

  /**
   * 지금 Pod 의 시작 시각(WP-1958) — 관찰한 started_at 과 보고가 올린 시작 시각 중 늦은 쪽. 새 Pod 를 관찰하기 전에도 옛 Pod 를 가른다.
   */
  public static OffsetDateTime currentPodStart(
      OffsetDateTime observedStartedAt, OffsetDateTime reportedPodStartedAt) {
    return laterOf(observedStartedAt, reportedPodStartedAt);
  }

  /** Pod 시작 시각이 지금 Pod 시작보다 시계 차이 여유를 넘게 앞선(옛 Pod) 시각인지 — 둘 중 하나라도 null 이면 거짓(WP-1958). */
  public static boolean isOlderPod(OffsetDateTime podStart, OffsetDateTime currentStart) {
    return podStart != null
        && currentStart != null
        && podStart.isBefore(podStartCutoff(currentStart));
  }

  /**
   * 보고가 들고 온 Pod 시작 시각을 받을지 가린다(WP-1958) — 서버 시각보다 {@link #POD_START_CLOCK_SKEW_GRACE} 넘게 앞선(미래) 값은
   * 시계 이상이라 없는 것(null)으로 본다. 잘못된 미래 값이 올라가면 이후 정상 보고가 모두 옛 Pod 로 오판되기 때문이다.
   */
  public static OffsetDateTime acceptedPodStart(OffsetDateTime reported, OffsetDateTime now) {
    if (reported == null) return null;
    return reported.isAfter(now.plus(POD_START_CLOCK_SKEW_GRACE)) ? null : reported;
  }

  /**
   * 이 칸이 지금 Pod 가 뜨기 전(옛 Pod)의 보고인지(WP-1253·WP-1958). 칸에 보고한 Pod 시작 시각이 있으면 그 시각이 지금 Pod 시작보다 시계 차이
   * 여유를 넘게 앞선지로 가른다(지금 Pod 시작을 모르면 거짓). 시각이 없는 칸(옛 플러그인)은 예전 규칙 — 서버가 받은 시각이 관찰한 시작 시각보다 앞선지 — 으로
   * 가른다(관찰값을 모르면 거짓).
   *
   * @param observedStartedAt runner 가 관찰한 지금 Pod 시작 시각
   * @param currentPodStart {@link #currentPodStart} 로 합친 지금 Pod 시작 시각
   */
  public static boolean isFromOldPod(
      Slot slot, OffsetDateTime observedStartedAt, OffsetDateTime currentPodStart) {
    if (slot.podStartedAt() != null) {
      return isOlderPod(slot.podStartedAt(), currentPodStart);
    }
    return observedStartedAt != null
        && slot.reportedAt().isBefore(podStartCutoff(observedStartedAt));
  }

  /**
   * AI 별 지금 Pod 시작 시각 묶음(WP-1958) — {@code observed} 는 runner 관찰값, {@code current} 는 보고값까지 합친 값(둘 다
   * null 가능).
   */
  public record PodStarts(OffsetDateTime observed, OffsetDateTime current) {}

  /**
   * 옛 Pod 칸({@link #isFromOldPod} — 같은 기준 {@link #podStartCutoff})을 한 문장으로 지운다. Pod 시작 시각이 있는 칸은 지금
   * Pod 시작(current) 기준으로, 없는 칸은 서버가 받은 시각을 관찰 시작(observed) 기준으로 가른다. 새 Pod 칸이 이미 보고했으면 그 보고는 시작 뒤라
   * 지워지지 않는다. 호출자는 메모리에서 옛 Pod 칸을 거른 AI 에 대해서만 부른다 — 지울 것이 없는 보고마다 DELETE 를 보내지 않게.
   *
   * @param starts AI id → 지금 Pod 시작 시각들
   * @param keepSlotKey 지우지 않을 칸 키 — 보고 흐름의 방금 보고한 칸(없으면 null)
   * @return 칸을 하나라도 지운 AI id 들
   */
  public Set<Long> deleteReportedBeforePodStart(Map<Long, PodStarts> starts, String keepSlotKey) {
    if (starts.isEmpty()) return Set.of();
    var t = AGENT_RUNTIME_SLOT_STATE;
    List<Row3<Long, OffsetDateTime, OffsetDateTime>> rows = new ArrayList<>();
    starts.forEach(
        (id, p) ->
            rows.add(
                DSL.row(
                    DSL.cast(id, t.AGENT_USER_ID.getDataType()),
                    DSL.cast(
                        p.observed() == null ? null : podStartCutoff(p.observed()),
                        t.REPORTED_AT.getDataType()),
                    DSL.cast(
                        p.current() == null ? null : podStartCutoff(p.current()),
                        t.REPORTED_AT.getDataType()))));
    @SuppressWarnings("unchecked")
    Table<?> v =
        DSL.values(rows.toArray(new Row3[0])).as("v", "agent_user_id", "obs_cutoff", "cur_cutoff");
    Field<Long> vId = v.field("agent_user_id", Long.class);
    Field<OffsetDateTime> vObs = v.field("obs_cutoff", OffsetDateTime.class);
    Field<OffsetDateTime> vCur = v.field("cur_cutoff", OffsetDateTime.class);
    // 메모리 판정(isFromOldPod)과 같은 규칙 — 시각 있는 칸은 current 기준, 없는 칸은 reported_at 을 observed 기준.
    var oldPod =
        t.POD_STARTED_AT
            .isNotNull()
            .and(t.POD_STARTED_AT.lt(vCur))
            .or(t.POD_STARTED_AT.isNull().and(t.REPORTED_AT.lt(vObs)));
    return new LinkedHashSet<>(
        dsl.deleteFrom(t)
            .using(v)
            .where(t.AGENT_USER_ID.eq(vId))
            .and(oldPod)
            .and(keepSlotKey == null ? DSL.noCondition() : t.SLOT_KEY.ne(keepSlotKey))
            .returning(t.AGENT_USER_ID)
            .fetch(t.AGENT_USER_ID));
  }
}
