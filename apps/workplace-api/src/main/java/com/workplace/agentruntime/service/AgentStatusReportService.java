package com.workplace.agentruntime.service;

import com.workplace.agentruntime.config.AgentRuntimeProperties;
import com.workplace.agentruntime.dto.AgentStatusReportRequest;
import com.workplace.agentruntime.dto.AgentStatusReportResponse;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.PodIdentity;
import com.workplace.agentruntime.repository.VisibleRuntimeState;
import com.workplace.auth.dto.ManagedKeyChain;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 상태 보고 서비스(WP-1250) — Works 가 띄운 AI 가 보고한 상태를 실행 설정의 agent_* 칸에 남기고, 그 AI 가 계속 일할지(RUN)·새 이슈를
 * 집지 말지(DRAIN)·곧 다시 띄워질지(RESTART)를 돌려준다. 호출자가 AI 인지는 컨트롤러가 인증 권한으로 먼저 확인한다.
 *
 * <p>칸별 보고(WP-1409): 한 Pod 에서 여러 프로젝트 칸(work-loop)을 도는 AI 는 칸마다 보고한다. 보고는 먼저 칸 테이블에 그 칸의 마지막 값으로
 * 남기고, 모든 칸을 {@link AgentSlotAggregate} 규칙(WORKING > BLOCKED > IDLE)으로 합친 값을 agent_* 칸에 쓴다 — 한 칸이
 * 일하는 중에 다른 칸이 쉬는 중을 보고해도 AI 는 작업 중이고 미뤄 둔 교체가 적용되지 않는다. 지금 Pod 가 뜨기 전에 받은 칸 보고(옛 Pod 의 칸)는 합치기 전에
 * 지운다(WP-1253 과 같은 기준 — reported_at &lt; started_at, 시계 차이 여유 30초). 마지막 보고가 오래된 칸(기본 6시간 — 죽은 칸)은
 * 지우지 않고 합치기에서만 뺀다.
 *
 * <p>실행 설정이 없는 AI(외부에서 돌리는 AI)는 아무것도 저장하지 않고 늘 RUN 이다 — 외부 AI 의 동작을 바꾸지 않는다. 테넌트가 정해지지 않은 키 인증(여러
 * 워크스페이스에 속한 AI 가 워크스페이스를 밝히지 않음)도 같다.
 *
 * <p>합친 상태가 쉬는 중(IDLE — 모든 칸이 쉼)으로 막 바뀌었는데 아직 반영되지 않은 generation 이 있으면 변경 이벤트를 내 runner 가 다시 조회하게
 * 한다 — 그때 {@link RolloutPolicy} 가 지금 적용으로 판정해 미뤄 둔 교체(설정 변경·키 교체)가 적용된다. 이미 쉬는 중이던 AI 의 거듭된 IDLE
 * 보고는 이벤트를 다시 내지 않는다. 쉬는 중이 아니어도 그 보고로 runner 판정({@link RolloutPolicy#decide})이 지금 적용으로 바뀌면 같은 이벤트를
 * 한 번 낸다(WP-2000).
 *
 * <p>보고로 화면에 보이는 AI 상태(상태·이슈 키·다음 확인 시각)가 달라졌을 때만 관리자 화면에 알린다(WP-1254) — 같은 내용의 거듭된 보고는 알리지 않는다.
 * 보이는 값이 그대로여도 적용 판정(RolloutPolicy)이 바뀌면(WP-2000 — 상세 응답이 판정을 싣는다) 알린다.
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class AgentStatusReportService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeSlotRepository slots;
  private final AgentSlotStateWriter slotWriter;
  private final RunnerWakeup wakeup;
  private final AgentApiKeyService agentKeys;
  private final AgentRuntimeChangeNotifier changeNotifier;
  private final AgentRuntimeProperties properties;

  /**
   * 상태 보고 처리. 순서: 테넌트가 없으면 RUN → 설정 행을 잠가 읽음(없으면 RUN — 칸도 저장하지 않는다) → Pod 정체 판정(WP-1968 — 관찰 정체와
   * 다르면 저장 없이 저장된 행 기준 응답, 낮은 generation 보고는 ADOPT 로 받지 않고(5차 반려 ④), 정체를 모르면 지금 시각 규칙) → 정체가 같아도 지금
   * Pod 보다 이른 시작 거절(5차 반려 ②) → 칸 저장 → 기준 갱신(정체가 같으면 보고 값으로 덮어씀) → 남아 있던 진입점 차단 메시지 비움(지금 generation
   * 이상이고 지금 Pod 의 보고일 때만, 화면에 보이던 것을 비우면 알림 포함) → 옛 Pod 칸 정리 → 모든 칸을 합쳐 agent_* 칸에 씀(비운 차단이 반영된 행 —
   * 응답·깨움 판정에 쓴다) → 합친 상태가 쉬는 중으로 막 바뀌었고 교체 대기면 이벤트 → 화면 값이 바뀌었거나 칸 차단을 비웠으면 알림(한 보고에 한 번) → 원하는 상태
   * 계산. 깨움은 막 쉬는 중이 됐거나 runner 판정이 지금 적용으로 바뀐 보고에서 한 번만 낸다.
   *
   * <p>설정 행을 먼저 잠그므로 같은 AI 의 두 칸이 동시에 보고해도 칸 쓰기·합치기가 차례로 서서 합친 값이 어긋나지 않는다.
   */
  public AgentStatusReportResponse report(long userId, AgentStatusReportRequest req) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return new AgentStatusReportResponse(AgentStatusReportResponse.RUN);
    Optional<Row> locked = settings.findForUpdate(userId);
    if (locked.isEmpty()) return new AgentStatusReportResponse(AgentStatusReportResponse.RUN);
    Row before = locked.get();

    String key = slotKeyOf(req.slot());
    OffsetDateTime now = OffsetDateTime.now();
    // 보고한 Pod 시작 시각(WP-1958) — 서버 시각보다 30초 넘게 앞선 값은 시계 이상이라 버린다(시각 없는 보고처럼 다룬다).
    OffsetDateTime pod = AgentRuntimeSlotRepository.acceptedPodStart(req.podStartedAt(), now);
    // 지금 Pod 시작 = 관찰한 시작 시각과 보고가 올려 둔 Pod 시작 시각 중 늦은 쪽 — runner 가 새 Pod 를 관찰하기 전에도 새 Pod 의 보고로
    // 옛 Pod 를 가른다. 정체 판정(아래)이 ADOPT 를 가르는 데도 이 값을 쓴다.
    OffsetDateTime current =
        AgentRuntimeSlotRepository.currentPodStart(
            before.startedAt(), before.reportedPodStartedAt());
    // WP-1968 반려 ①: 보고에 실은 Pod 정체(metadata.uid)를 지금까지 알던 정체와 견본다 — 관찰(약 60초)을 기다리지 않고 보고가 스스로 밝힌다.
    // 지금 정체와 같으면 지금 Pod(MATCH), 바로 앞 정체면 끝나는 중인 옛 Pod(OTHER — 저장 없이 버린 채 저장된 행 기준 응답), 그 밖에 보고에
    // 시작 시각이 있으면 재시작 직후 새 Pod 가 밝힌 정체(ADOPT — 지금 Pod 로 받아들인 뒤 MATCH 로 잇는다). 정체를 모르면(보고에 없음 —
    // 옛 이미지) 지금처럼 시각 규칙으로 가른다. ADOPT 는 보고의 Pod 시작이 지금 알던 Pod 시작보다 30초 넘게 이른 경우에 거절하고(C1 — 두
    // 세대 넘게 지연된 옛 Pod), 시작 시각이 없는 모르는 정체도 거절한다(OTHER — 2차 반려 ②) : acceptedPodStart 가 시계 이상을 걸러
    // null 로 만든 뒤 검사 없이 ADOPT 되면 정체가 과거로 되돌아 영구 교착이 생기고, 관찰이 정체를 밝힌 뒤 MATCH 로 받기 때문이다.
    PodIdentity identity =
        AgentRuntimeSlotRepository.podIdentity(
            req.podUid(), before.observedPodUid(), before.previousPodUid(), pod, current);
    // 5차 반려 ④: 낮은 generation 보고는 정체를 ADOPT 하지 않는다 — 몇 초만 살았던 옛 Pod 의 늦은 보고가 정체를 되돌리면(observed=옛
    // Pod,
    // previous=지금 Pod) 살아 있는 지금 Pod 가 영원히 previous 로 남아 이 뒤의 상태 보고가 계속 무시된다. 막힌 보고는 OTHER 로 바뀌어
    // 아래에서
    // 저장 없이 저장된 행 기준 응답을 준다.
    identity =
        AgentRuntimeSlotRepository.barStaleAdopt(identity, req.generation(), before.generation());
    if (identity == PodIdentity.ADOPT) {
      log.info(
          "보고가 처음 밝힌 Pod 정체를 지금 Pod 로 받았어요: agentUserId={} slot={} podUid={} previous={}",
          userId,
          key,
          req.podUid(),
          before.observedPodUid());
      before = settings.adoptPodIdentity(before, req.podUid(), pod);
      identity = PodIdentity.MATCH;
    }
    if (identity == PodIdentity.OTHER) {
      log.info(
          "지난 Pod 의 늦은 상태 보고를 버렸어요: agentUserId={} slot={} podUid={} observedPodUid={}",
          userId,
          key,
          req.podUid(),
          before.observedPodUid());
      return new AgentStatusReportResponse(desiredFor(before, req.generation(), tenantId, null));
    }
    // 시각 거절은 정체와 상관없이 본다(5차 반려 ②) — 같은 Pod 안 컨테이너 재시작(restartPolicy Always → uid 고정)에서는 정체가 같아도
    // 재시작 전 컨테이너의 늦은 보고가 기준을 되돌려 WP-1958 이 회귀한다. 지금 Pod 시작보다 30초 넘게 이른 시작은 정체가 같아도 지금 Pod 가
    // 아니다. 정체를 모르는 보고(UNKNOWN)도 같은 시각 규칙이다 — 늦은 보고는 칸·합친 상태·차단 비움 어느 것도 쓰지 않는다(새 Pod 가 IDLE
    // 인데 옛 Pod 의 WORKING 이 칸을 덮어 AI 가 영영 작업 중으로 남는다). 응답(원하는 상태)은 저장된 행 기준으로 준다.
    if (AgentRuntimeSlotRepository.isOlderPod(pod, current)) {
      log.info(
          "옛 Pod 의 늦은 상태 보고를 버렸어요: agentUserId={} slot={} podStartedAt={} currentPodStart={}",
          userId,
          key,
          pod,
          current);
      return new AgentStatusReportResponse(desiredFor(before, req.generation(), tenantId, null));
    }
    // 칸 행에는 이 보고를 보낸 Pod 정체를 남긴다(WP-1968 반려 ③) — 정체가 없는 보고(옛 플러그인)는 null 로 남아 기존 시각 규칙으로 가른다.
    slots.upsert(
        userId, key, req.state(), req.issueKey(), req.nextCheckAt(), now, pod, req.podUid());
    // 기준(reported_pod_started_at) 갱신과 이 보고 뒤의 기준(합치기 계산에 쓴다) — 갱신 규칙·근거는 메서드 문서(WP-1968).
    OffsetDateTime basisAfter = settings.refreshReportedPodStart(before, identity, pod);
    OffsetDateTime newCurrent =
        AgentRuntimeSlotRepository.currentPodStart(before.startedAt(), basisAfter);
    // 칸이 도는 중인 보고 = 칸이 띄워졌다는 증거 — 남아 있던 진입점 차단 보고를 비운다(WP-1913 백스톱).
    // 진입점이 다시 차단되면 그때 다시 쌓인다. 비우려면 아래 두 조건을 **모두** 만족해야 한다.
    // ① generation — 보고한 generation 이 차단의 generation 이상일 때만. 차단 generation 을 모르는(_null) 옛 이미지의
    //    차단은 **지금 돌고 있는 Pod 의 generation(관찰 generation)** 과 견준다 — 원하는 generation 과 견주면 교체가
    //    미뤄진 동안 지금 Pod 가 gen-1 로 보고해 칸이 영영 비워지지 않고 건강한 AI 가 FAILED 로 남는다(리뷰 반려 ②).
    //    관찰 generation 도 모르면 견주지 않는다. generation 을 싣지 않은 보고(옛 플러그인)도 견주지 않고 그대로 믿는다.
    // ② 지금 Pod — 보고에 실은 **Pod 시작 시각**이 지금 Pod 의 시작 시각보다 30초 이상 뒤일 때만(= podStartCutoff(startedAt)
    //    이후). 그보다 앞선 보고는 끝나는 중인 옛 Pod 의 것이라 새 Pod 진입점이 다시 보고하기 전에 「오류」를 지우면 안 된다(WP-1253
    //    칸 거르기와 같은 여유). 서버가 보고를 받은 시각으로는 이 판정을 못 한다 — 옛 Pod 의 늦은 보고도 새 Pod 가 뜬 뒤에 도착해
    //    받은 시각이 늘 지금이기 때문이다(리뷰 반려 ①). 지금 Pod 를 아직 관찰 전(시작 시각 null)이거나, 보고가 시각을 모르면
    //    그대로 믿는다.
    // 알림은 실제로 화면에 보이던 사유(currentPaneBlocked)를 비울 때만 보낸다 — 차단은 읽을 때
    // FAILED+사유로 합쳐져 VisibleRuntimeState 에 없으므로 아래 비교로는 잡히지 않는데,
    // 가려진 옛 사유를 비우는 동작은 화면이 그대로라 알림이 나가면 안 된다(리뷰 반려 ③).
    boolean paneStored = AgentRuntimeStatusResolver.blocked(before.paneBlockedMessage());
    boolean paneVisible =
        AgentRuntimeStatusResolver.blocked(AgentRuntimeStatusResolver.currentPaneBlocked(before));
    Long blockedGeneration =
        before.paneBlockedGeneration() != null
            ? before.paneBlockedGeneration()
            : before.observedGeneration();
    boolean fromCurrentGeneration =
        req.generation() == null
            || blockedGeneration == null
            || req.generation() >= blockedGeneration;
    // ② 지금 Pod — 정체가 같은 보고는 여기까지 오기 전 위 시각 거절(5차 반려 ② — 지금 Pod 시작과 견빔)을 이미 통과했고, 칸이 기록한 시작
    //    (pane_blocked_pod_started_at)과는 정체로 견준다(WP-1968 반려 ④: 끝나는 중인 옛 Pod 가 빠른 시계로 그 값을 높게 올려 둔
    // 뒤에도 지금
    //    Pod 가 자기 차단을 비울 수 있게). 정체를 모르는 보고(옛 플러그인)는
    //    지금까지처럼 보고에 실은 **Pod 시작 시각**이 지금 Pod 보다 30초 이상 뒤일 때만(= podStartCutoff(startedAt) 이후). 그보다
    // 앞선
    //    보고는 끝나는 중인 옛 Pod 의 것이라 새 Pod 진입점이 다시 보고하기 전에 「오류」를 지우면 안 된다(WP-1253 칸 거르기와 같은 여유).
    //    서버가 보고를 받은 시각으로는 이 판정을 못 한다 — 옛 Pod 의 늦은 보고도 새 Pod 가 뜬 뒤에 도착해 받은 시각이 늘 지금이기 때문이다(리뷰
    //    반려 ①). 지금 Pod 를 아직 관찰 전(시작 시각 null)이거나, 보고가 시각을 모르면 그대로 믿는다.
    OffsetDateTime podRef =
        before.paneBlockedPodStartedAt() != null
            ? before.paneBlockedPodStartedAt()
            : before.startedAt();
    boolean fromCurrentPod =
        identity == PodIdentity.MATCH || !AgentRuntimeSlotRepository.isOlderPod(pod, podRef);
    boolean mayClearPane = fromCurrentGeneration && fromCurrentPod;
    if (paneStored && mayClearPane) {
      settings.updatePaneBlocked(userId, null, null, null, null, null);
    }
    boolean visiblePaneCleared = paneVisible && mayClearPane;

    // 옛 Pod 칸은 빼고(있을 때만 지움), 오래 보고가 끊긴 칸(죽은 칸)도 빼고 합쳐 쓴다. 방금 보고한 칸은 옛 Pod 거르기에서 늘 제외되고 보고
    // 시각이 지금이라 오래되지도 않으므로 늘 남는다 — 그래서 agent_reported_at(AgentSlotAggregate.latestReportedAt)도 지금이다.
    // 차단을 비운 뒤에 쓰므로 RETURNING 행에 비운 차단이 반영된다 — 응답·깨움 판정이 이 보고가 지운 차단을 다시 읽지 않는다.
    Row row =
        slotWriter.write(
            userId,
            slots.findAll(userId),
            before.observedPodUid(),
            before.startedAt(),
            newCurrent,
            now,
            key);

    // 「쉬는 중으로 막 바뀜」은 합친 상태로 판정한다 — 모든 칸이 쉬게 된 보고에서만 이벤트가 나간다.
    boolean becameIdle = row.isIdle() && !before.isIdle();
    boolean wake = becameIdle && row.hasUnappliedGeneration();
    // 키 사슬은 RUN 이고 전 또는 후가 미반영일 때만 한 번 읽어 판정 전후 비교와 desiredFor 가 함께 쓴다(WP-2000) — 미반영이 아니면 decide 가
    // NONE 이다.
    ManagedKeyChain keys = null;
    boolean decisionChanged = false;
    if (row.desired() == Desired.RUN
        && (before.hasUnappliedGeneration() || row.hasUnappliedGeneration())) {
      keys = agentKeys.managedChain(userId, tenantId);
      // 화면 알림은 화면이 읽는 판정(pending), 깨우기는 runner 가 읽는 판정(decide)의 전이로 본다.
      decisionChanged =
          RolloutPolicy.pendingChanged(before, row, keys, now, properties.slotStaleAfter());
      // 쉬는 중이 아니어도 판정이 NOW 로 바뀌면(예: 키 만료·Pod 없는 실패) 깨운다. 위 becameIdle 과 겹쳐도 한 번만 낸다.
      wake |= RolloutPolicy.becameNow(before, row, keys, now, properties.slotStaleAfter());
    }
    if (wake) wakeup.publishChanged(tenantId, row.locationId());
    // 한 보고에서 관리자 알림은 한 번 — 화면 상태나 적용 판정이 바뀌었거나 칸 차단을 비웠을 때만(같은 내용의 거듭된 보고는 알리지 않음).
    if (visiblePaneCleared || decisionChanged || VisibleRuntimeState.of(before).differsFrom(row)) {
      changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, userId, null);
    }
    return new AgentStatusReportResponse(desiredFor(row, req.generation(), tenantId, keys));
  }

  /** 요청의 칸 → 저장 칸 키. 없거나 빈 값은 {@code ''}(옛 단일 칸), 그 밖은 대문자 — 'wp' 와 'WP' 를 같은 칸으로. */
  static String slotKeyOf(String slot) {
    return slot == null ? "" : slot.toUpperCase(Locale.ROOT);
  }

  /**
   * 원하는 상태 — 꺼졌으면 DRAIN(지워지는 Pod 가 새 이슈를 집지 않게 하는 안전장치 — 끄기 자체는 runner 가 바로 한다). 보고한 generation 이
   * 설정보다 뒤처졌으면 runner 의 {@code applyNow} 와 같은 판정({@link RolloutPolicy})이 지금 적용이면 RESTART, 아니면
   * DRAIN(쉬면 runner 가 다시 띄운다). 그 밖에 「새 작업 받기」가 꺼져 있으면 HOLD, 아니면 RUN(STOP 이 HOLD 보다 먼저). 키 사슬은 뒤처졌을
   * 때만 읽는다.
   *
   * @param row 이번 보고를 합쳐 쓴 뒤의 행(모든 칸이 쉬면 IDLE — 그때만 쉴 때 적용이 지금 적용으로 바뀐다)
   * @param readKeys 이미 읽은 키 사슬(없으면 null — 뒤처졌을 때 읽는다)
   */
  private String desiredFor(
      Row row, Long reportedGeneration, long tenantId, ManagedKeyChain readKeys) {
    if (row.desired() == Desired.STOP) return AgentStatusReportResponse.DRAIN;
    if (reportedGeneration == null || reportedGeneration >= row.generation()) {
      // 뒤처지지 않은 경우만 HOLD 를 본다 — 뒤처졌으면 새 설정으로 다시 떠야 하므로 RESTART/DRAIN 이 먼저(WP-1514).
      return row.acceptNewWork() ? AgentStatusReportResponse.RUN : AgentStatusReportResponse.HOLD;
    }
    ManagedKeyChain keys =
        readKeys != null ? readKeys : agentKeys.managedChain(row.agentUserId(), tenantId);
    RolloutPolicy.Decision decision =
        RolloutPolicy.decide(row, keys, OffsetDateTime.now(), properties.slotStaleAfter());
    return decision == RolloutPolicy.Decision.NOW
        ? AgentStatusReportResponse.RESTART
        : AgentStatusReportResponse.DRAIN;
  }
}
