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
import org.jooq.Condition;
import org.jooq.DSLContext;
import org.jooq.Field;
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
   * @param podUid 그 칸 보고를 보낸 Pod 정체(WP-1968 반려 ③) — 있으면 시계가 아니라 정체로 옛 Pod 칸을 가른다. 보고에 없으면 null(옛
   *     플러그인) — 그 경우에만 위 시각 규칙으로 가른다. 노드 시계가 빨라 죽은 Pod 가 높은 시작 시각을 들고 있어도 칸이 남지 않는다.
   */
  public record Slot(
      String slotKey,
      AgentState state,
      String issueKey,
      OffsetDateTime nextCheckAt,
      OffsetDateTime reportedAt,
      OffsetDateTime podStartedAt,
      String podUid) {}

  /**
   * 칸 보고를 쓴다 — 없으면 넣고 있으면 상태·이슈 키·다음 확인·보고 시각 네 칸을 늘 함께 덮어쓴다(쉬는 중 보고가 옛 이슈 키를 지운다). WP-1958 부터 보고한
   * Pod 시작 시각(pod_started_at)도 늘 덮어쓴다 — 시각 없는 보고가 옛 시각을 남기지 않게. 실행 설정 행이 있어야 한다(FK).
   *
   * @param podUid 그 칸 보고를 보낸 Pod 정체(WP-1968 반려 ③) — 없으면 null(옛 플러그인). 옛 플러그인도 이 한 곳에서만 넣어, 뒤의 옛 Pod
   *     판정은 모두 정체를 먼저 본다.
   */
  public void upsert(
      long agentUserId,
      String slotKey,
      AgentState state,
      String issueKey,
      OffsetDateTime nextCheckAt,
      OffsetDateTime reportedAt,
      OffsetDateTime podStartedAt,
      String podUid) {
    // 빈 정체는 넣지 않는다(WP-1968 반려 M1·2차 반려 ⑤) — 메모리 판정은 공백을 null 로 보는데 SQL 은 `'' ≠ 현재 정체` 로 봐 두
    // 판정이 갈리기 때문이다. null 로 통일해 지금 정체와 다르다고 SQL 이 칸을 지우지 않게 한다.
    String identity = nullIfNoIdentity(podUid);
    var t = AGENT_RUNTIME_SLOT_STATE;
    dsl.insertInto(t)
        .set(t.AGENT_USER_ID, agentUserId)
        .set(t.SLOT_KEY, slotKey)
        .set(t.STATE, state.name())
        .set(t.ISSUE_KEY, issueKey)
        .set(t.NEXT_CHECK_AT, nextCheckAt)
        .set(t.REPORTED_AT, reportedAt)
        .set(t.POD_STARTED_AT, podStartedAt)
        .set(t.POD_UID, identity)
        .onConflict(t.TENANT_ID, t.AGENT_USER_ID, t.SLOT_KEY)
        .doUpdate()
        .set(t.STATE, state.name())
        .set(t.ISSUE_KEY, issueKey)
        .set(t.NEXT_CHECK_AT, nextCheckAt)
        .set(t.REPORTED_AT, reportedAt)
        .set(t.POD_STARTED_AT, podStartedAt)
        .set(t.POD_UID, identity)
        .execute();
  }

  /**
   * 옛 Pod 칸을 가를 때 두는 시계 차이 여유 — 30초. reported_at 은 API 서버 시계, started_at 은 runner·kubelet 시계라 서로 조금
   * 어긋날 수 있다. 새 Pod 칸이 시작 직후 보고했는데 API 시계가 조금 늦어 「Pod 시작 전 보고」로 잘못 지워지지 않게 시작 시각보다 30초 넘게 앞선 보고만 옛
   * Pod 의 것으로 본다(WP-1409).
   */
  public static final Duration POD_START_CLOCK_SKEW_GRACE = Duration.ofSeconds(30);

  /**
   * 기준 없는 ADOPT 표시({@code basisless_pod_uid})가 다른 정체의 ADOPT 를 막는 창 — 60초(관찰 1주기), <b>서버 시각</b>
   * 기준(WP-2026 3차 반려 ①). 그 안에는 정체를 모르는 자리에서 기준 없이 밝힌 정체를 지키고, 지나면 막지 않는다 — 표시 잠금이 영구 교착이 되지 않게 하는
   * 시간 제한이다. 노드 시계로 재면 이 이슈(시계 앞섬)와 같은 구멍이 나므로 {@code basisless_marked_at} 에 적어 둔 서버 시각과 비교한다.
   */
  public static final Duration BASISLESS_LOCK = Duration.ofSeconds(60);

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
        r.getPodStartedAt(),
        r.getPodUid());
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
   * 보고 시각이 시계 이상으로 {@link #acceptedPodStart} 가 null 로 만든 값인지(WP-2026) — 보고에 시각은 있었으나 30초 여유 밖이라 걸러진
   * 경우와 애초에 시각이 없는 보고를 가르는 데 쓴다. 두 보고 서비스가 같은 자리에서 같은 뜻으로 계산하게 {@link #acceptedPodStart} 옆에 둔다.
   */
  public static boolean clockSkewFiltered(OffsetDateTime reported, OffsetDateTime accepted) {
    return reported != null && accepted == null;
  }

  /**
   * 상태·칸 보고의 Pod 정체 판정(WP-1968 반려 ①) — 보고에 실은 Pod 정체를 지금까지 알던 정체(지금 Pod · 바로 앞 Pod)와 견본다. 시계 대신 정체로
   * 받고/버려, 빠른 시계를 가진 죽은 Pod 가 높은 시작 시각을 올려 지금 Pod 의 보고를 오판하지 않는다.
   *
   * <p>정체는 보고가 스스로 밝힌다 — runner 관찰(약 60초)을 기다리지 않으므로 재시작 직후 새 Pod 의 첫 보고도 지금 Pod 로 받는다. 관찰은 바로 앞
   * 정체를 되돌리지 않는다({@code previous_pod_uid}).
   */
  public enum PodIdentity {
    /**
     * 정체가 같다 — 지금 Pod 의 보고. 정체 판정 자체는 시각을 보지 않고(정체가 과거로 뒤집히는 일을 시계로 오판하지 않기 위해) 가른다. 다만 두 보고 서비스는
     * 판정 뒤에 {@link #isOlderPod} 시각 비교를 함께 본다(WP-1968 5차 반려 ②) — 같은 Pod 안 컨테이너 재시작(restartPolicy
     * Always → uid 같음)에서 재시작 전 컨테이너의 늦은 보고가 기준을 되돌리지 못하게.
     */
    MATCH,
    /**
     * 정체가 다르다(지금 정체도 바로 앞 정체도 아님) — 지금 Pod 가 밝힌 정체라 곧바로 지금 Pod 로 받아들인다. 단 보고에 시작 시각이 있어야 한다(2차 반려
     * ②).
     */
    ADOPT,
    /** 정체가 지난 것이다 — 끝나는 중인 옛 Pod 의 늦은 보고라 저장 없이 버린다. */
    OTHER,
    /** 정체를 견볼 수 없다(보고에 없음 — 옛 이미지) — 지금처럼 시각 규칙으로 가른다. */
    UNKNOWN
  }

  /**
   * 보고의 Pod 정체({@code podUid})와 지금까지 알던 정체를 견본다(WP-1968 반려 ①·⑥·C1·2차 반려 ②·④).
   *
   * <p>시계 이상 플래그를 받는 인자는 꼭 필요한 자리에서만 쓴다 — 지금까지 main 코드의 호출자는 두 보고 서비스뿐이고, 거기서만 시계 이상 여부를 안다. 플래그를
   * 모르는 자리가 생기면 이 인자를 빼지 말고 명시적으로 {@code false} 를 넘길 것: 빼면 시계 이상으로 걸러진 값과 애초에 시각이 없는 보고가 같은 거절로 묶여
   * WP-2026 이 조용히 다시 열린다(WP-2026 리뷰 반려 ②).
   *
   * @param reportPodUid 보고에 실은 정체 — 없으면(옛 이미지) 시계 규칙이던 {@link PodIdentity#UNKNOWN}
   * @param observedPodUid 지금 Pod 로 아는 정체 — 없으면(아직 한 번도 관찰·보고받지 못함) 처음 밝히는 보고인데, 보고에 시작 시각이 있어야
   *     {@link PodIdentity#ADOPT} 다(6차 반려 ①). 이때는 상태를 비우지 않는다(⑥ 배포 뒤 첫 인식을 새 Pod 로 오판하지 않기 위해). 단
   *     시각이 이미 늦은(이른) 정체는 3차 반려 ③ 처럼 {@link PodIdentity#OTHER} — 관찰 전이어도 지금 알던 시작보다 이른 정체는 ADOPT 로
   *     되돌리지 않는다
   * @param previousPodUid 바로 앞에 알던 정체 — 보고의 정체가 여기 있으면 끝나는 중인 옛 Pod ({@link PodIdentity#OTHER})
   * @param reportedPodStartedAt 보고에 실은 그 Pod 시작 — ADOPT 를 가르는 데 쓴다. null 이면 첫 인식을 포함해 {@link
   *     PodIdentity#OTHER}(2차 반려 ②·6차 반려 ①) 단, 시계 이상으로 걸러진 값이고 정체 미확정이거나 기준 없이 밝힌 정체 자리의 재시작이면
   *     {@link PodIdentity#ADOPT}(WP-2026·WP-2032)
   * @param currentPodStartedAt 지금 알던 Pod 시작({@code max(started_at, reported_pod_started_at)}) — 이보다
   *     30초 넘게 이른 정체는 두 세대 넘게 지연된 옛 Pod ({@link PodIdentity#OTHER})
   * @param clockSkewFiltered 보고 시각이 시계 이상으로 {@link #acceptedPodStart} 가 null 로 만든 값인지 — 보고에 시각은
   *     있었으나 서버보다 30초 넘게 앞선 경우와 애초에 시각이 없는 보고를 가르는 데 쓴다(WP-2026)
   * @param basislessPodUid 기준 없이 밝힌 정체의 표시({@code basisless_pod_uid}) — 지금 관찰 정체와 <b>같은 자리</b>에서만
   *     시계 이상으로 걸러진 재시작 보고를 {@link PodIdentity#ADOPT} 로 회복한다(WP-2032). 표시가 없는 자리면 null 을 명시적으로
   *     넘긴다(규칙을 모르는 자리를 만들지 말라는 위 계약 — 표시 유무가 조용히 바뀌지 않게)
   * @param rawReportedPodStartedAt 보고에 실린 Pod 시작을 <b>걸리기 전 그대로</b> 넘긴 값 — {@code acceptedPodStart}
   *     로 걸러 진 뒤에는 null 이라 위 {@code reportedPodStartedAt} 에서는 회복 근거를 만들 수 없다. 걸리지 않은 보고면 그 값이 그대로다
   * @param basislessPodStartedRaw 표시({@code basisless_pod_uid})를 남긴 그 보고의 걸리기 전 시작 — 회복이 이 값과 <b>같은
   *     시계</b>로 견주게 하는 기준(WP-2032 리뷰 반려 ①). 위 {@code currentPodStartedAt} 은 서버 시각이라 걸리기 전 raw 와 견주면
   *     늘 참이 된다. null 이면(마이그레이션 전 표시) 첫 회복 보고로 값을 세우는 데까지만 허용한다
   */
  public static PodIdentity podIdentity(
      String reportPodUid,
      String observedPodUid,
      String previousPodUid,
      OffsetDateTime reportedPodStartedAt,
      OffsetDateTime currentPodStartedAt,
      boolean clockSkewFiltered,
      String basislessPodUid,
      OffsetDateTime rawReportedPodStartedAt,
      OffsetDateTime basislessPodStartedRaw) {
    // 빈 문자열(공백뿐인 문자열 포함)은 null 과 같은 뜻 — 「모른다」로 두어 시각 규칙으로 가르게 한다. 지금 Pod 이 비어 있는 정체를
    // 보냈는데 OTHER 로 보면 관찰 정체와 달라져 지금 Pod 의 보고가 거절되고, 빈 정체끼리면 MATCH 로 시각 검사 없이 받아진다.
    if (isNoIdentity(reportPodUid)) return PodIdentity.UNKNOWN;
    if (reportPodUid.equals(observedPodUid)) return PodIdentity.MATCH;
    if (!isNoIdentity(previousPodUid) && reportPodUid.equals(previousPodUid)) {
      return PodIdentity.OTHER;
    }
    // 지금 알던 Pod 시작보다 30초 넘게 이른 정체는 지금 Pod 이 아니라 두 세대 넘게 지연돼 도착한 옛 Pod 라 새로 받아들이지 않는다(WP-1968
    // 반려 C1, 시계 차이 여유는 {@link #isOlderPod} 와 같다 — 2차 반려 ④: 부풀려 놓은 기준(죽은 빠른 시계 Pod 가 올린 값)에 25초 빠른 새
    // Pod 보고가 걸려 관찰(약 60초)까지 OTHER 로 버려지지 않게). 그걸 ADOPT 로 받으면 정체가 과거로 되돌아가 살아 있는 지금 Pod 가
    // previous 로 남아 영원히 OTHER — 상태 보고는 계속 무시되고 칸 보고는 409 루프, 그 Pod 의 관찰은 stale 로 필터돼 스스로 풀리지
    // 않는다. 관찰(약 60초)이 정체를 밝히면 그때 MATCH 로 잇으니 늦어도 막히지 않는다.
    if (isOlderPod(reportedPodStartedAt, currentPodStartedAt)) return PodIdentity.OTHER;
    // 시작 시각 없는 보고는 ADOPT 로 받지 않는다 — 첫 인식도 같다(6차 반려 ① · 2차 반려 ② 확장). acceptedPodStart 가 서버 시계보다
    // 30초 넘게 앞선 시작을 null 로 걸러 내기 때문에, 빠른 시계 노드의 죽은 옛 Pod 늦은 보고가 검사 없이 ADOPT 되면 정체가 과거로
    // 되돌아 1번과 같은 영구 교착이 생긴다. 첫 인식에서 시각 없이 ADOPT 하면 그 인식이 기준 없이 박히고, 그 뒤 옛 Pod 가 시각을 실어
    // 다시 ADOPT 하면 previous 가 그 옛 Pod 로 박혀 살아 있는 지금 Pod 는 영구 OTHER(상태 미저장·칸 409)가 된다(6차 반려 ①).
    // 관찰(약 60초)이 정체와 시작 시각을 함께 밝힌 뒤 MATCH 로 잇는다.
    if (reportedPodStartedAt == null) {
      // ① 시계 이상으로 걸러진 값이고 정체 미확정(관찰·앞 정체 모두 비어 있음)이면 첫 ADOPT 를 허용한다 — 보고에 시각은 있었으나 서버보다
      // 30초 넘게 앞선 경우, 관찰 보고에 정체를 싣지 못하는 구 runner 는 회복 경로가 없어 이 조합에서만 새 Pod 가 영구 OTHER 가 됐다
      // (WP-2026). 이 ADOPT 는 기준 없이 정체만 갈아끼우므로 adoptPodIdentity 가 표시(basisless_pod_uid)와 그 표시 시각
      // (basisless_marked_at)을 함께 남기고, 두 보고 서비스는 그 표시를 보는 barBasislessAdopt 로 **서버 시각 60초 창 안에서만**
      // 다른 정체의 ADOPT 를 막는다 — 「관찰 정체 있는데 기준 없음」 전체가 아니라 **기준 없이 밝힌 정체에 한정**해서다(WP-2026 리뷰 반려
      // ①·②: 시각 없는 관찰 자리에서는 새 Pod 의 정상 시각 보고를 그대로 ADOPT 로 받아야 한다). 창 밖·관찰이 표시 뒤에 생긴 시작을
      // 비춤·표시 정체가 지금 정체와 달라지면 막지 않는다 — 표시 잠금이 특정 미래 사건 하나에만 걸려 영구 교착이 되지 않게(3차 반려 ①).
      // ② 정체 미확정은 아니지만 지금 관찰 정체가 기준 없이 밝힌 정체(표시)와 같은 자리면, 그 자리의 재시작 보고도 ADOPT 로 받는다
      // (WP-2032) — 그 자리는 애초에 시각 기준 없이 정체만 박힌 곳이라 C1({@link #isOlderPod})이 판정할 근거가 없고, 같은 노드에서
      // Pod 가 다시 뜨면 새 Pod 의 시계 이상 보고가 여기에 닿지 못해 영구 OTHER(상태 미저장·칸 409)가 됐다.
      // **기준 없는 자리만** 허용하는 이유: 관찰·시각으로 확인된 정체 자리는 시계 이상 다른 정체를 ADOPT 로 받으면 살아 있는 Pod 가
      // previous 로 박혀 6차 반려 ① 교착이 다시 열리고, 거기서는 관찰(약 60초)이 정체와 시각을 밝혀 MATCH 로 잇는 경로가 이미 있다.
      // 교착이 유지되는 이유: 이 분기는 위 previous 매칭 뒤에 나오므로 살아 있는 옛 Pod 의 늦은 보고는 계속 OTHER 이고, 회복 ADOPT 도
      // adoptPodIdentity 가 표시를 다시 남아 이후 보고의 barBasislessAdopt(서버 시각 60초 창)·barStaleAdopt(generation
      // 검사)가 잇는다.
      // 표시 잠금은 **표시 직후 60초 안의 도약만** 막고, 그 뒤의 회복은 표시를 지나 즉시 일어난다 — 즉 잠금이 교착을 넓게 지키는 근거가 아니라,
      // 표시 직후 곧바로 갈아끼우는 도약만 막는 마지막 요소다. 오래 지난 뒤 도착한 죽은 Pod 의 시계 이상 보고는 정체를 갈아끼울 수 있다(WP-2032).
      // **그 구멍은 회복 근거로 막는다**(WP-2032 리뷰 반려 ①) — 위 C1 은 걸러진 보고에 시각이 없어 판정하지 못하고, 첫 기준 없는 ADOPT 는
      // previous 가 비어 있어 previous 매칭도 서지 않는다. 그래서 ② 는 표시를 남긴 그 보고의 <b>걸리기 전 시작</b>(같은 노드 시계의
      // basisless_pod_started_raw)보다 늦는 — 곧 「표시 정체보다 새 Pod」라는 근거가 있을 때만 회복한다. 지금 알던 Pod 시작
      // (currentPodStartedAt)과 견보면 안 된다 — 그 값은 서버 시각 이하이고 걸리기 전 raw 는 서버보다 30초 넘게 앞서 늘 참이기
      // 때문이다(2차 반려 ①). 근거가 없으면(걸리기 전 값을 아직 모르거나, 보고가 그보다 이르면) OTHER 로 두어 관찰(새 runner)이 정체를
      // 밝힌 뒤 MATCH 로 잇게 한다. 표시 정체가 지금 관찰 정체와 다른 자리(관찰이 갈아끼운 뒤)는 회복하지 않는다.
      if (clockSkewFiltered
          && isRecoverySpot(
              observedPodUid,
              previousPodUid,
              basislessPodUid,
              rawReportedPodStartedAt,
              basislessPodStartedRaw)) {
        return PodIdentity.ADOPT;
      }
      return PodIdentity.OTHER;
    }
    // 첫 인식(정체를 아직 모름)은 위 두 검사 뒤에 본다(3차 반려 ③) — 관찰 전이어도 지금 알던 시작보다 이른 정체의 늦은 보고가 ADOPT 되면
    // 배포 직후에라도 started_at 을 그 옛 Pod 값으로 되돌린다. 이제 첫 인식도 시작 시각을 요구하므로(위, 시계 이상 필터는 위 null 분기에서만
    // 예외) 기준 없는 ADOPT 는 없다.
    return PodIdentity.ADOPT;
  }

  /**
   * 시계 이상으로 걸러진 보고를 ADOPT 로 받을 수 있는 자리인지 — 둘뿐이다(WP-2026 · WP-2032). 정체 미확정 자리(관찰·앞 정체가 모두 비어 있어 첫
   * ADOPT 를 허용하는 자리)와, 정체 미확정 자리에서 기준 없이 밝힌 정체가 지금 관찰 정체와 같은 자리의 재시작(그 자리는 애초에 시각 기준 없이 정체만 박혀 있어
   * 회복할 자리). 관찰·시각으로 확인된 정체 자리는 여기에 넣지 않는다 — 그쪽은 시계 이상 다른 정체를 ADOPT 로 받으면 살아 있는 Pod 가 previous 로 박혀
   * 6차 반려 ① 교착이 다시 열린다.
   *
   * <p><b>표시 자리(②)의 회복은 근거가 있을 때만</b>(WP-2032 리뷰 반려 ①) — 표시를 남긴 그 보고의 <b>걸리기 전</b> 시작(같은 노드 시계의
   * {@code basisless_pod_started_raw})보다 이번 보고의 걸리기 전 시작이 늦을 때, 곧 「표시 정체보다 새 Pod 라는 근거」가 있을 때만 true
   * 다. 지금 알던 Pod 시작({@code max(started_at, reported_pod_started_at)})과 견보는 것은 쓰지 않는다 — 그 값은 서버 시각
   * 이하이고 시계 이상으로 걸러진 보고의 걸리기 전 시작은 서버보다 30초 넘게 앞서, 견보면 늘 참이라 근거가 없는 옛 Pod 보고도 통과하기 때문이다. 근거 없이 받으면
   * 60초 표시 잠금이 지난 뒤 죽은 옛 Pod 늦은 시계 이상 보고가 정체를 가져가(시각이 없어 C1 도, 빈 previous 도 막지 못한다) 살아 있는 Pod 가
   * previous 로 박혀 영구 OTHER/409 가 된다. 근거가 없으면 관찰(새 runner)이 정체와 시각을 밝힌 뒤 MATCH 로 잇는다. 정체 미확정 자리(①)는
   * 이 근거를 요구하지 않는다 — 거기는 아직 밝힌 정체가 없어 옮겨갈 살아 있는 Pod 가 없다(WP-2026 그대로).
   *
   * @param observedPodUid 지금 관찰 중인 Pod 정체
   * @param previousPodUid 바로 앞에 쓰던 Pod 정체
   * @param basislessPodUid 기준 없이 ADOPT 로만 밝힌 정체({@code basisless_pod_uid}) — 없으면 null
   * @param rawReportedPodStartedAt 이번 보고에 실린 시작 시각(걸리기 전 그대로) — 근거로 견볼 값
   * @param basislessPodStartedRaw 표시를 남긴 그 보고의 걸리기 전 시작({@code basisless_pod_started_raw}) — 같은 시계
   *     기준. null 이면 마이그레이션 전 표시라 첫 회복 보고로 값을 세우는 데까지만 허용한다
   * @return 정체 미확정 자리이거나, 표시 자리의 재시작이며 근거가 있으면 true
   */
  private static boolean isRecoverySpot(
      String observedPodUid,
      String previousPodUid,
      String basislessPodUid,
      OffsetDateTime rawReportedPodStartedAt,
      OffsetDateTime basislessPodStartedRaw) {
    if (isNoIdentity(observedPodUid)) return isNoIdentity(previousPodUid);
    // 근거: 표시를 남긴 보고의 걸리기 전 시작(같은 노드 시계)보다 이번 보고의 걸리기 전 시작이 늦은 것 — 이른 시작의 보고는 표시
    // 정체보다 옛 Pod 다. 두 값이 모두 걸리기 전 raw 라 노드 시계끼리 견줄 수 있다.
    boolean newerPod =
        rawReportedPodStartedAt != null
            && (basislessPodStartedRaw == null
                || rawReportedPodStartedAt.isAfter(basislessPodStartedRaw));
    return observedPodUid.equals(basislessPodUid) && newerPod;
  }

  /**
   * 낮은 generation 보고는 정체를 ADOPT 하지 않는다(WP-1968 5차 반려 ④) — 몇 초만 살았던 옛 Pod(B)의 늦은 보고가 정체를 되돌리면
   * (observed=B·previous=C) 살아 있는 지금 Pod(C)가 영원히 previous 로 남아 버려진다: 상태 보고는 계속 무시되고 칸 보고는 409, 그
   * Pod 의 관찰은 stale 로 필터된다. 보고한 generation 이 지금 설정 generation 보다 작으면 그 보고를 낸 Pod 는 지금 배포보다 앞 세대라 지금
   * Pod 로 받아들일 수 없다 — 지금 정체를 모르는 첫 인식(ADOPT)이라도 같다. 두 값 중 하나라도 모르면(정체 없는 옛 이미지) 판정하지 않는다.
   *
   * @param identity 정체 판정 결과 — ADOPT 가 아니면 값이 그대로다
   * @param reportedGeneration 보고에 실은 generation
   * @param currentGeneration 지금 설정 generation
   * @return ADOPT 를 막았으면 {@link PodIdentity#OTHER}(저장 없이 버림 — 칸은 409, 상태는 저장된 행 기준 응답), 그 밖은 원래 값
   */
  public static PodIdentity barStaleAdopt(
      PodIdentity identity, Long reportedGeneration, Long currentGeneration) {
    if (identity != PodIdentity.ADOPT) return identity;
    if (reportedGeneration == null || currentGeneration == null) return identity;
    return reportedGeneration < currentGeneration ? PodIdentity.OTHER : identity;
  }

  /**
   * 기준(시각) 없이 밝힌 정체의 표시는 <b>짧은 창 안에서만</b> 다른 정체의 ADOPT 를 막는다(WP-2026 리뷰 반려 ① — 3차 반려로 해제 조건을 바꿈) —
   * 시계 이상으로 걸러진 첫 ADOPT 는 기준을 세우지 못해 위 C1({@link #isOlderPod})이 판정하지 못한다. 그 동안 정상 시각의 다른 정체를 ADOPT
   * 로 받으면 앞서 밝힌 살아 있는 정체가 previous 로 박혀 영구 교착(상태 미저장·칸 409)이 되살아난다.
   *
   * <p>표시 잠금을 「표시 정체가 앞으로 정상 시각으로 기준을 채울 때까지」(1~3차 반려의 규칙)로 두면, 그 사건이 오지 않는 상태가 매번 새 교착이 된다 (3차 반려
   * ① 시계가 계속 앞선 노드 → 정상 노드 새 Pod 로 교체해도 영구 409, ② MATCH 가 기준을 채워도 표시가 남아 관찰이 기준을 비운 뒤 새 Pod ADOPT 를
   * 다시 막음). 그래서 해제 조건을 <b>지금 행에 이미 있는 값</b>으로 바꿨다 — 셋 중 하나면 막지 않는다:
   *
   * <ol>
   *   <li>(a) <b>서버 시각 기준 {@link #BASISLESS_LOCK} 경과</b> — 노드 시계로 재면 이 이슈(시계 앞섬)와 같은 구멍이 나므로 표시를 남긴
   *       서버 시각({@code basisless_marked_at})과 지금 서버 시각으로 잰다
   *   <li>(b) <b>관찰이 표시 뒤에 생긴 시작을 {@code started_at} 에 비췄다</b> — 그 시점부터 C1 이 다시 제대로 선다. 서버 시각보다
   *       앞선(시계 이상) 시작은 신뢰하지 않는다
   *   <li>(c) <b>표시가 지금 정체와 다르다</b> — 표시를 남긴 정체는 이미 갈아끼워졌다는 뜻
   * </ol>
   *
   * <p><b>표시가 있는 자리에만</b> 건다(2차 반려 ②) — 관찰로 정체만 알고 시각은 모르는 자리(시각 없는 관찰)는 표시가 없어 새 Pod 의 정상 시각 보고를
   * ADOPT 로 받아야 한다(기존 동작).
   *
   * @param identity 정체 판정 결과 — ADOPT 가 아니면 값이 그대로다
   * @param basislessPodUid 기준 없이 ADOPT 로만 밝힌 정체({@code basisless_pod_uid}) — 없으면 막지 않는다
   * @param basislessMarkedAt 위 표시를 남긴 서버 시각({@code basisless_marked_at}) — 없으면 창을 잴 수 없어 막지 않는다
   * @param reportedPodStartedAt 보고가 올려 둔 Pod 시작 기준({@code reported_pod_started_at}) — null 이면 아직
   *     기준이 없다
   * @param observedPodUid 지금 Pod 로 아는 정체 — 표시 정체와 다르면 (c) 로 풀린다
   * @param startedAt 관찰이 비친 지금 Pod 시작({@code started_at}) — 표시 뒤에 생긴 시작이면 (b) 로 풀린다
   * @param serverNow 지금 서버 시각 — 창 경과를 재는 기준(노드 시계 아님)
   * @return ADOPT 를 막았으면 {@link PodIdentity#OTHER}(저장 없이 버림 — 칸은 409, 상태는 저장된 행 기준 응답), 그 밖은 원래 값
   */
  public static PodIdentity barBasislessAdopt(
      PodIdentity identity,
      String basislessPodUid,
      OffsetDateTime basislessMarkedAt,
      OffsetDateTime reportedPodStartedAt,
      String observedPodUid,
      OffsetDateTime startedAt,
      OffsetDateTime serverNow) {
    if (identity != PodIdentity.ADOPT) return identity;
    if (isNoIdentity(basislessPodUid)) return identity;
    if (basislessMarkedAt == null) return identity;
    // (c) 표시를 남긴 정체가 이미 다른 정체로 갈아끼워졌으면 막을 대상이 없다.
    if (!basislessPodUid.equals(observedPodUid)) return identity;
    // (b) 표시 뒤에 생긴(더 늦은) 관찰 시작 — 서버 시각보다 앞선 값은 노드 시계 앞섬이라 이 이슈와 같은 구멍이 나므로 신뢰하지 않는다.
    if (startedAt != null
        && startedAt.isAfter(basislessMarkedAt)
        && !startedAt.isAfter(serverNow)) {
      return identity;
    }
    // (a) 서버 시각 기준 짧은 창 — 창 안에서만 기준 없는 ADOPT 자리를 지킨다.
    if (!basislessMarkedAt.plus(BASISLESS_LOCK).isAfter(serverNow)) return identity;
    return reportedPodStartedAt == null ? PodIdentity.OTHER : identity;
  }

  /** 정체가 없는 상태 — null 또는 공백뿐인 문자열. 빈 문자열은 null 과 같은 뜻으로 다뤄야 한다(WP-1968·2차 반려 ⑤). */
  private static boolean isNoIdentity(String podUid) {
    return podUid == null || podUid.isBlank();
  }

  /**
   * 정체가 없는 값은 null 로 — 메모리 판정({@link #isNoIdentity})이 공백을 「모른다」로 보는 것처럼 저장·SQL 도 같은 뜻으로 보게 한다
   * (WP-1968·2차 반려 ⑤). 관찰 갱신·칸 삭제·칸 저장이 한 규칙을 쓴다.
   *
   * @param podUid 보고·판정에 쓰는 정체(공백 포함)
   * @return 실제 정체 또는 null
   */
  public static String nullIfNoIdentity(String podUid) {
    return isNoIdentity(podUid) ? null : podUid;
  }

  /**
   * 한 보고(칸 한 줄·합친 AI 상태·차단 기록)가 옛 Pod 의 것인지 가르는 **한 규칙**(WP-2010 — 칸 거르기 메모리·SQL 과 적용 판정이 함께 쓴다).
   * 위에서부터 처음 맞는 갈래로 정한다(WP-1958·WP-1968·WP-2010).
   *
   * <ol>
   *   <li>정체를 둘 다 알고 다르면 시각과 무관하게 옛 것이다(노드 시계가 빨라도 죽은 Pod 가 남지 않게).
   *   <li>보고가 Pod 시작 시각을 실었으면 지금 Pod 시작과 {@link #isOlderPod} 로 견준다 — 정체가 같아도 이 갈래다. 같은 Pod 안 컨테이너
   *       재시작은 uid 가 같아 시각으로만 가를 수 있고, 이를 빼면 앞 컨테이너의 WORKING 칸이 남아 설정이 영영 나가지 않는다.
   *   <li>시작 시각 없이 정체가 같으면 옛 것이 아니다 — 서버 시계와 노드 시계를 견주면 지금 Pod 의 보고가 지워질 수 있다.
   *   <li>그 밖(정체를 모르는 시각 없는 보고)은 보고 시각이 {@code timelessBasis} 의 cutoff({@link #podStartCutoff})보다
   *       앞서는지로 가른다. 칸 거르기는 보고가 올릴 수 있는 기준이 아니라 runner 가 관찰한 started_at 을 쓴다(빠른 시계의 보고가 기준을 올려 지금
   *       Pod 칸을 되돌릴 수 없이 지우지 않게).
   * </ol>
   *
   * <p>견줄 값을 모르면 그 갈래에서는 옛 것이 아니다.
   *
   * <p>칸 거르기는 ④ 의 기준이 관찰한 started_at 으로 따로라 6인자 판정을 쓴다.
   *
   * @param reportPodUid 보고의 Pod 정체(모르면 null·공백)
   * @param reportPodStartedAt 보고가 실은 Pod 시작 시각(모르면 null)
   * @param reportedAt 보고를 받은 시각 — 서버 시계(모르면 null)
   * @param currentPodUid 지금 Pod 정체(모르면 null·공백)
   * @param currentPodStart 지금 Pod 시작 — 시작 시각을 실은 보고와 견주고, 시각 없는 보고(④)의 기준으로도 쓴다(모르면 null)
   */
  public static boolean isOldPodReport(
      String reportPodUid,
      OffsetDateTime reportPodStartedAt,
      OffsetDateTime reportedAt,
      String currentPodUid,
      OffsetDateTime currentPodStart) {
    return isOldPodReport(
        reportPodUid,
        reportPodStartedAt,
        reportedAt,
        currentPodUid,
        currentPodStart,
        currentPodStart);
  }

  /**
   * 시각 없는 보고(④)의 기준을 따로 받는 판정 — 규칙과 나머지 인자는 5인자 판정과 같다.
   *
   * @param timelessBasis 시각 없는 보고(④)와 견줄 기준(칸 거르기는 관찰한 started_at, 모르면 null)
   */
  public static boolean isOldPodReport(
      String reportPodUid,
      OffsetDateTime reportPodStartedAt,
      OffsetDateTime reportedAt,
      String currentPodUid,
      OffsetDateTime currentPodStart,
      OffsetDateTime timelessBasis) {
    boolean bothKnown = !isNoIdentity(reportPodUid) && !isNoIdentity(currentPodUid);
    // ① 정체가 다르면 시각과 무관하게 옛 것.
    if (bothKnown && !reportPodUid.equals(currentPodUid)) return true;
    // ② 시작 시각이 있으면 같은 노드 시계끼리 견준다(같은 정체 — 컨테이너 재시작 — 도).
    if (reportPodStartedAt != null) return isOlderPod(reportPodStartedAt, currentPodStart);
    // ③ 시각 없는 같은 정체는 서버 시계와 노드 시계를 견주지 않는다.
    if (bothKnown) return false;
    // ④ 정체를 모르는 시각 없는 보고만 기준과 견준다.
    return timelessBasis != null
        && reportedAt != null
        && reportedAt.isBefore(podStartCutoff(timelessBasis));
  }

  /**
   * 이 칸이 지금 Pod 가 뜨기 전(옛 Pod·같은 Pod 의 재시작 전 컨테이너)의 보고인지(WP-1253·WP-1958·WP-1968 반려 ③·WP-2010) — 칸의
   * 값으로 {@link #isOldPodReport} 를 부른다(규칙·까닭은 그쪽).
   *
   * @param slot 칸 한 줄
   * @param currentPodUid 지금 Pod 정체(모르면 null·공백)
   * @param observedStartedAt runner 가 관찰한 지금 Pod 시작 — 시각 없는 칸의 기준(모르면 null)
   * @param currentPodStart {@link #currentPodStart} 로 합친 지금 Pod 시작 — 시각 있는 칸의 기준(모르면 null)
   */
  public static boolean isFromOldPod(
      Slot slot,
      String currentPodUid,
      OffsetDateTime observedStartedAt,
      OffsetDateTime currentPodStart) {
    return isOldPodReport(
        slot.podUid(),
        slot.podStartedAt(),
        slot.reportedAt(),
        currentPodUid,
        currentPodStart,
        observedStartedAt);
  }

  /**
   * AI 별 지금 Pod 판정 묶음(WP-1958·WP-1968 반려 ③·WP-2010) — {@code observed} 는 runner 관찰값(시각 없는 칸의 기준),
   * {@code current} 는 보고값까지 합친 값(시각 있는 칸의 기준), {@code podUid} 는 지금 Pod 정체(모르면 null). 쓰임은 {@link
   * #isOldPodReport}. 빈 정체(공백)는 만들 때 null 로 맞춘다 — 메모리 판정이 공백을 「모른다」로 보는데 SQL 만 실제 값으로 봐 형제 칸을 지우기
   * 때문이다(WP-1968 2차 반려 ⑤).
   */
  public record PodStarts(OffsetDateTime observed, OffsetDateTime current, String podUid) {
    public PodStarts {
      podUid = nullIfNoIdentity(podUid);
    }
  }

  /**
   * 옛 Pod 칸({@link #isFromOldPod})을 한 문장으로 지운다 — 메모리 판정과 같은 {@link #isOldPodReport} 규칙의 SQL 판이다.
   * 호출자는 메모리에서 옛 Pod 칸을 거른 AI 에 대해서만 부른다 — 지울 것이 없는 보고마다 DELETE 를 보내지 않게.
   *
   * @param starts AI id → 지금 Pod 판정(시각·정체)
   * @param keepSlotKey 지우지 않을 칸 키 — 보고 흐름의 방금 보고한 칸(없으면 null)
   * @return 칸을 하나라도 지운 AI id 들
   */
  public Set<Long> deleteReportedBeforePodStart(Map<Long, PodStarts> starts, String keepSlotKey) {
    if (starts.isEmpty()) return Set.of();
    var t = AGENT_RUNTIME_SLOT_STATE;
    List<org.jooq.Row4<Long, OffsetDateTime, OffsetDateTime, String>> rows = new ArrayList<>();
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
                        t.REPORTED_AT.getDataType()),
                    DSL.cast(p.podUid(), t.POD_UID.getDataType()))));
    @SuppressWarnings("unchecked")
    Table<?> v =
        DSL.values(rows.toArray(new org.jooq.Row4[0]))
            .as("v", "agent_user_id", "obs_cutoff", "cur_cutoff", "pod_uid");
    Field<Long> vId = v.field("agent_user_id", Long.class);
    Field<OffsetDateTime> vObs = v.field("obs_cutoff", OffsetDateTime.class);
    Field<OffsetDateTime> vCur = v.field("cur_cutoff", OffsetDateTime.class);
    Field<String> vUid = v.field("pod_uid", String.class);
    // isOldPodReport 문서의 ①~④ 를 그대로 옮긴다 — 두 판정이 갈리면 지우고도 읽기에서 다시 걸러 칸이 남는다.
    // NULL 비교는 거짓이 되므로 기준을 모르는 갈래는 지우지 않는다(메모리 판정의 「모르면 옛 것이 아니다」와 같다).
    Condition identityOld = t.POD_UID.isNotNull().and(vUid.isNotNull()).and(t.POD_UID.ne(vUid));
    Condition identitySame = t.POD_UID.isNotNull().and(vUid.isNotNull()).and(t.POD_UID.eq(vUid));
    Condition olderStart = t.POD_STARTED_AT.isNotNull().and(t.POD_STARTED_AT.lt(vCur));
    Condition timelessOld =
        t.POD_STARTED_AT.isNull().andNot(identitySame).and(t.REPORTED_AT.lt(vObs));
    Condition oldPod = identityOld.or(olderStart).or(timelessOld);
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
