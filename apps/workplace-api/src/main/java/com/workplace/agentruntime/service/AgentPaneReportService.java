package com.workplace.agentruntime.service;

import com.workplace.agentruntime.config.AgentRuntimeProperties;
import com.workplace.agentruntime.dto.AgentPaneReportRequest;
import com.workplace.agentruntime.dto.ApplyMode;
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
import java.util.Objects;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * 칸 차단 보고 서비스(WP-1913) — Pod 안 진입점이 칸을 띄우지 못하면(설정·로그인 오류 등) 이유를 실행 설정의 pane_blocked_* 칸에 남겨 관리자 화면이
 * 「오류」+이유를 보여 주게 한다. runner 관찰 보고가 쓰는 칸과 분리해 저장하고, 읽을 때만 합친다(덮어쓰기 없음 — runner 보고와 겹치지 않는다).
 *
 * <p>보고는 최선 노력이다 — 워크스페이스가 정해지지 않았거나 실행 설정이 없는 AI(외부 실행)는 조용히 끝낸다(진입점은 보고 실패로 멈추지 않는다). 본문이 잘못됐을 때만
 * 400 으로 알려 준다(호출 스크립트 버그). 다만 서버가 **다시 보내면 받을 수 있는 보고**(정체 불일치 · 지금 Pod 보다 이른 옛 Pod)는 409 로 답한다 —
 * 호출하는 감독 회차(gw-boot)가 이를 실패로 봐 「보냈다」는 표식을 남기지 않고 다시 보내게(WP-1968). 시작 OK 가 한 번 버려지면 차단 칸이 영영 풀리지 않아
 * 관리자 화면에 「오류」가 영구히 남기 때문이다. 반대로 다시 보내도 성공할 수 없는 버림(정체 없는 옛 이미지의 generation 불일치)은 예전처럼 조용한 204 다 —
 * 409 로 답하면 표식 없이 계속 다시 보내는 고리가 생긴다(WP-1968 2차 반려 ③). 호출자가 AI 인지는 컨트롤러가 인증 권한으로 먼저 확인한다.
 *
 * <p>칸 차단은 읽을 때만 합치므로 VisibleRuntimeState 가 잡지 못한다 — 그래서 화면에 합치는 값({@link
 * AgentRuntimeStatusResolver#currentPaneBlocked})이 실제로 바뀔 때만 관리자 화면 실시간 알림을 보내, 이미 열려 있는 화면이
 * 「오류」+사유를 놓치지 않는다(WP-1913). 저장 원문이 아니라 화면 기준으로 비교하므로, 같은 사유를 다른 generation 에서 다시 보고해 화면이 「시작 중」 →
 * 「오류」로 바뀔 때도 알림이 나간다(WP-1913 리뷰 반려 ①).
 */
@Slf4j
@Service
@Transactional
@RequiredArgsConstructor
public class AgentPaneReportService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeChangeNotifier changeNotifier;
  private final AgentRuntimeSlotRepository slots;
  private final AgentSlotStateWriter slotWriter;
  private final RunnerWakeup wakeup;
  private final AgentApiKeyService agentKeys;
  private final AgentRuntimeProperties properties;

  /**
   * 칸 차단 보고 처리. 순서: 본문 검증(state 는 BLOCKED·OK 만) → 메시지에서 제어 문자 정제(아래 {@link #sanitizeMessage} — 정제 뒤
   * 공백뿐이면 400) → 테넌트 없으면 조용히 return → 설정 행을 잠가 읽고(없으면 조용히 return) generation 거르기({@link
   * #acceptableGeneration} — WP-1969: 정체가 같은 보고도 같은 기준) → Pod 정체 판정(WP-1968 반려 ① — 관찰을 기다리지 않고 보고가
   * 밝힌 정체로 지금 Pod 를 정한다: ADOPT 는 지금 Pod 로 받아들이고(시각·기준도 그 값 — 단 보고에 시작 시각이 있어야 하고, 시계 이상으로 걸러진 값이면
   * 기준을 비우고 표시({@code basisless_pod_uid})를 남긴다(WP-2026), 2차 반려 ②, 낮은 generation 보고는 받지 않는다 — 5차 반려
   * ④), OTHER 은 409로 버린다) → 시각 판정(정체를 몰라도 정체가 같아도 지금 Pod 보다 이른 시작은 409 — 같은 Pod 안 컨테이너 재시작의 재시작 전
   * 보고가 기준을 되돌리지 못하게, 5차 반려 ②) → 기준 갱신 → message·시각 기록(OK 면 칸 비움) → BLOCKED 면 칸 합침({@link
   * #mergeSlotsOnBlock}) → 미뤄 둔 generation 이 지금 적용이 되면(runner 판정 decide) runner 깨움 → 화면에 합치는 값이나 화면
   * 적용 판정(pending)이 바뀌면 관리자 화면에 알림.
   *
   * <p>500자 상한은 매개변수 바인딩({@code @Size})에서 이미 먼저 검증된다 — 검증을 통과한 값을 정제하므로, 정제가 길이를 늘리지 않는 한 500자를 넘는
   * 값은 저장될 수 없고, 정제는 제어 문자를 같은 수의 공백으로 바꾸고 앞뒤를 떼기만 하므로 길이가 늘지 않는다.
   */
  public void report(long userId, AgentPaneReportRequest req) {
    // jakarta validation 은 조건부 필수(BLOCKED 일 때만 message)를 표현할 수 없어 여기서 검증한다.
    boolean blocked = "BLOCKED".equals(req.state());
    if (!blocked && !"OK".equals(req.state())) {
      throw new IllegalArgumentException("state 는 BLOCKED 또는 OK 여야 합니다");
    }
    // 저장 전에 제어 문자를 정제한다 — 정제 뒤 공백만 남으면 이유가 없는 차단이라 원래 공백 메시지와 같이 400.
    String message = sanitizeMessage(req.message());
    if (blocked && (message == null || message.isBlank())) {
      throw new IllegalArgumentException("차단 보고에는 이유(message)가 필요합니다");
    }
    // 보고는 최선 노력 — 워크스페이스·실행 설정이 없으면 조용히 끝낸다(기존 AgentStatusReportService 와 동일).
    // 되돌릴 수 없는 상태가 아니라 재시도로도 나아지지 않으므로 409 가 아니라 204 다.
    if (TenantContext.get() == null) return;
    Optional<Row> locked = settings.findForUpdate(userId);
    if (locked.isEmpty()) return;
    Row before = locked.get();
    // 옛 Pod 의 늦은 보고는 지금 generation 이 아니라서 버린다(WP-1913 리뷰 반려 ①).
    // 새 generation 이 뜬 뒤에 온 옛 Pod 의 차단이 지금 사유를 덮거나, 옛 OK 가 지금 차단을 지우면 안 된다.
    // 보고는 최선 노력이라 조용히 204 로 끝낸다(WP-1968 2차 반려 ③ — 409 로 알리면 표식 없이 계속 다시 보내는 고리가 생긴다).
    // 예외는 acceptableGeneration 에 있다(WP-1969) — 「쉴 때 적용」 대기 중 지금 도는 Pod 의 보고는 받는다.
    // 정체가 같은(MATCH) 보고도 여기서 같은 기준으로 가른다 — 정체 판정이 generation 을 건너뛰면 화면 판정과 어긋나
    // 「오류」가 안 뜬다(WP-1968 5차 반려 ③).
    if (!acceptableGeneration(req.generation(), blocked, before)) return;
    // 보고한 Pod 시작 시각(WP-1958) — 서버 시각보다 30초 넘게 앞선 값은 시계 이상이라 기준·시각 판정에는 없는 것처럼 버린다(단 정체
    // 판정에는 아래 clockSkewFiltered 로 「시계 이상으로 걸러진 값」임을 함께 넘겨 애초에 시각이 없는 보고와 갈린다 — WP-2026).
    OffsetDateTime now = OffsetDateTime.now();
    OffsetDateTime pod = AgentRuntimeSlotRepository.acceptedPodStart(req.podStartedAt(), now);
    // 시계 이상으로 걸러진 값인지(WP-2026) — 정체 판정에 「시각은 있었으나 걸러진 값」과 애초에 시각이 없는 보고를 갈라 넘긴다.
    boolean clockSkewFiltered =
        AgentRuntimeSlotRepository.clockSkewFiltered(req.podStartedAt(), pod);
    // 지금 Pod 시작 = 관찰한 시작 시각과 칸 보고가 올려 둔 Pod 시작 시각 중 늦은 쪽 — 정체 판정(아래)이 ADOPT 를 가르는 데도 이 값을 쓴다.
    OffsetDateTime current =
        AgentRuntimeSlotRepository.currentPodStart(
            before.startedAt(), before.reportedPodStartedAt());
    // WP-1968 반려 ①: 보고에 실은 Pod 정체(metadata.uid)를 지금까지 알던 정체와 견본다 — 관찰(약 60초)을 기다리지 않고 보고가 스스로 밝힌다.
    // 지금 정체와 같으면 지금 Pod(MATCH), 바로 앞 정체면 끝나는 중인 옛 Pod(OTHER — 저장 없이 버림), 그 밖에 보고에 시작 시각이 있으면
    // 재시작 직후 새 Pod 가 밝힌 정체(ADOPT — 지금 Pod 로 받아들인 뒤 MATCH 로 잇는다). 정체를 모르면(보고에 없음 — 옛 이미지) 지금처럼
    // 시각 규칙으로 가른다. ADOPT 는 보고의 Pod 시작이 지금 알던 Pod 시작보다 30초 넘게 이른 경우에 거절하고(C1 — 두 세대 넘게 지연된 옛
    // Pod) : 관찰이 정체를 밝힌 뒤 MATCH 로 잇기 때문이다. 애초에 시각이 없는 모르는 정체도 거절한다(OTHER — 2차 반려 ②). 다만 시계
    // 이상으로 걸러진 값이고 정체 미확정(관찰·앞 정체 모두 비어 있음)이면 ADOPT 로 받는다(WP-2026) — 보고에 시각은 있었던 것이므로, 관찰
    // 보고에 정체를 싣지 못하는 구 runner 는 이 조합에서 시작 OK 가 영영 409 로 버려졌다. 이 ADOPT 는 기준(시각)을 세우지 못하므로
    // adoptPodIdentity 가 표시(basisless_pod_uid)와 표시 시각(basisless_marked_at)을 함께 남고 아래
    // barBasislessAdopt 가 그 표시가 선
    // **서버 시각 60초 창 안에서만** 다른 정체의 ADOPT 를 막아(WP-2026 리뷰 반려 ①·3차 반려 ①) 정상 시각의 다른 정체가 정체를 갈아끼워
    // 살아 있는 Pod 가 previous 로 박히는 교착이 다시 열리지 않는다. 시각 없는 관찰 자리에는 표시가 없어 막지 않는다 — 거기서는 새 Pod 의
    // 정상 시각 보고를 ADOPT 로 받아야 한다(2차 반려 ②). 표시가 선 자리의 정체가 정상 시각 보고를 MATCH 로 이어 보고 기준
    // (reported_pod_started_at)을 채우면 표시·표시 시각을 함께 지우고 일반 규칙으로 돌아간다(3차 반려 ②) — 정체 없는 관찰이 started_at
    // 을
    // 되살려도 그 시작이 표시 시각보다 늦지 않으면 창은 그대로다(2차 반려 ①의 다른 순서). 정체를 이미 아는 구간은 위 거절이 그대로다(6차
    // 반려 ① 교착 유지).
    PodIdentity identity =
        AgentRuntimeSlotRepository.podIdentity(
            req.podUid(),
            before.observedPodUid(),
            before.previousPodUid(),
            pod,
            current,
            clockSkewFiltered);
    // 5차 반려 ④: 낮은 generation 보고는 정체를 ADOPT 하지 않는다 — 몇 초만 살았던 옛 Pod 의 늦은 보고가 정체를 되돌리면(observed=옛
    // Pod,
    // previous=지금 Pod) 살아 있는 지금 Pod 가 영원히 previous 로 남아 이 뒤의 칸 보고가 계속 409 가 된다. 막힌 보고는 OTHER 로 바뀌어
    // 아래 409 에서 저장 없이 버려진다.
    identity =
        AgentRuntimeSlotRepository.barStaleAdopt(identity, req.generation(), before.generation());
    // 기준 없이 밝힌 정체의 표시(basisless_pod_uid)는 짧은 창(서버 시각 60초) 안에서만 다른 정체의 ADOPT 를 막는다(WP-2026 3차 반려 ①)
    // —
    // 표시가 있는 자리에만 막아, 시각 없는 관찰 자리에서는 새 Pod 의 정상 시각 보고를 그대로 ADOPT 로 받는다(2차 반려 ②). 창 밖(서버 시각 60초
    // 경과)·관찰이 표시 뒤에 생긴 시작을 비춤·표시가 지금 정체와 다름 — 셋 중 하나면 막지 않는다. 표시 잠금을 특정 미래 사건 하나에만 걸어 두면
    // 그 사건이 안 오는 상태마다 영구 교착이 돼 3차 반려 ①·② 가 나왔기 때문이다.
    identity =
        AgentRuntimeSlotRepository.barBasislessAdopt(
            identity,
            before.basislessPodUid(),
            before.basislessMarkedAt(),
            before.reportedPodStartedAt(),
            before.observedPodUid(),
            before.startedAt(),
            // 창은 표시를 남길 때와 같은 DB 서버 시각으로 재야 길이가 어긋나지 않는다(위 now 는 노드 시계와 견주는 값).
            settings.dbNow());
    if (identity == PodIdentity.ADOPT) {
      log.info(
          "보고가 처음 밝힌 Pod 정체를 지금 Pod 로 받았어요: agentUserId={} state={} podUid={} previous={}",
          userId,
          req.state(),
          req.podUid(),
          before.observedPodUid());
      before = settings.adoptPodIdentity(before, req.podUid(), pod);
      identity = PodIdentity.MATCH;
    }
    if (identity == PodIdentity.OTHER) {
      log.info(
          "지난 Pod 의 늦은 칸 차단 보고를 버렸어요: agentUserId={} state={} podUid={} observedPodUid={}",
          userId,
          req.state(),
          req.podUid(),
          before.observedPodUid());
      // 버린 보고를 409 로 알려 gw-boot 가 표식을 남기지 않고 다시 보내게 — 시작 OK 가 한 번 버려져 차단이 영영
      // 풀리지 않게(WP-1968). 지난 정체뿐 아니라 애초에 시각이 없는 모르는 정체(2차 반려 ②)도 여기 든다(시계 이상으로 걸러진 값은 정체
      // 미확정일 때만 위에서 ADOPT — WP-2026) — 관찰(약 60초)이 정체를 밝힌 뒤엔 MATCH 로 받아지므로 다시 보내면 성공한다.
      throw new ResponseStatusException(HttpStatus.CONFLICT, "지금 Pod 의 보고가 아닙니다");
    }
    // generation 판정은 위 acceptableGeneration 에서 이미 했다(WP-1969 · 5차 반려 ③) — 정체를 모르는(옛 이미지) 보고뿐 아니라
    // 정체가 같은(MATCH) 보고도 같은 기준으로 가른다. 그 예외(「쉴 때 적용」 대기 중 지금 도는 Pod)로 받은 보고는 아래에서
    // 화면 판정이 견줄 값(지금 설정 generation)으로 칸 차단 generation 을 싣는다.
    // 다시 보내면 성공할 수 있는 버림(정체 불일치·지금 Pod 보다 이른 옛 Pod)에만 409 를 쓴다.
    // 시각 거절은 정체와 상관없이 본다(5차 반려 ②) — 같은 Pod 안 컨테이너 재시작(restartPolicy Always → uid 고정)에서는 정체가 같아도
    // 재시작 전 컨테이너의 늦은 보고가 기준을 되돌리고 차단 칸을 덮어 WP-1958 이 회귀한다. 지금 Pod 시작보다 30초 넘게 이른 시작은 정체가
    // 같아도 지금 Pod 가 아니다. 정체를 모르는 보고(UNKNOWN)도 같은 시각 규칙이다. 버림은 모두 409 로 알린다.
    if (AgentRuntimeSlotRepository.isOlderPod(pod, current)) {
      log.info(
          "옛 Pod 의 늦은 칸 차단 보고를 버렸어요: agentUserId={} state={} podStartedAt={} currentPodStart={}",
          userId,
          req.state(),
          pod,
          current);
      throw new ResponseStatusException(HttpStatus.CONFLICT, "지금 Pod 의 보고가 아닙니다");
    }
    // 기준(reported_pod_started_at) 갱신과 이 보고 뒤의 기준(화면 계산에 쓴다) — 갱신 규칙·근거는 메서드 문서(WP-1968).
    OffsetDateTime basisAfter = settings.refreshReportedPodStart(before, identity, pod);
    // OK 는 칸 비움(null) — BLOCKED 는 이유·지금 시각·보고한 Pod 의 generation·시작 시각을 함께 기록한다.
    String nextMessage = blocked ? message : null;
    OffsetDateTime nextBlockedAt = blocked ? now : null;
    Long nextBlockedGeneration = blocked ? req.generation() : null;
    OffsetDateTime nextBlockedPod = blocked ? pod : null;
    settings.updatePaneBlocked(
        userId, nextMessage, nextBlockedAt, nextBlockedGeneration, nextBlockedPod);
    // OK 는 칸을 합치지 않고, 아래 상태 변화 판정만 한다(WP-1969).
    Row merged = blocked ? mergeSlotsOnBlock(userId, before, basisAfter, now) : before;
    // 이 보고로 미뤄 둔 generation 이 지금 적용으로 바뀌면 runner 를 한 번 깨운다(WP-1969) — BLOCKED 든 OK 든 같다.
    // 보고 전(before)과 최종 저장 행(BLOCKED 는 merged — 차단·올라간 Pod 시작·합친 AI 상태 반영, OK 는 칸 차단을 지운 뒤 행)의
    // runner 판정(decide)을 견준다. 이미 지금 적용이던 AI 나 거듭된 같은 보고는 전이가 아니라 알리지 않는다.
    // 같은 컨테이너가 아직 일하면(WORKING 칸이 남음) 지금 적용이 되지 않아 알리지 않는다.
    // 꺼 둔 AI 는 깨우지 않는다 — desired 가 RUN 일 때만 알린다.
    // 화면 알림은 따로 화면이 읽는 판정(pending)의 전후로 본다(WP-2000) — 상세 응답이 그 판정을 싣는다.
    boolean decisionChanged = false;
    if (before.desired() == Desired.RUN && before.hasUnappliedGeneration()) {
      long tenantId = TenantContext.get();
      ManagedKeyChain keys = agentKeys.managedChain(userId, tenantId);
      Row after = blocked ? merged : settings.find(userId).orElse(before);
      decisionChanged =
          RolloutPolicy.pendingChanged(before, after, keys, now, properties.slotStaleAfter());
      if (RolloutPolicy.becameNow(before, after, keys, now, properties.slotStaleAfter())) {
        wakeup.publishChanged(tenantId, after.locationId());
      }
    }
    // 화면에 보이는 것(「오류」+사유)이 실제로 바뀔 때만 알린다 — 바뀌는 기준은 저장 원문이 아니라,
    // 읽을 때 화면에 합치는 AgentRuntimeStatusResolver.currentPaneBlocked 이다.
    // gen 3 이 막힌 뒤 설정을 고쳐 gen 4 가 되고, gen 4 Pod 가 같은 사유를 보고하면 저장 원문은 그대로여도
    // 화면이 「시작 중」 → 「오류」로 바뀌는데 원문 기준이면 알림이 나가지 않아, 목록·상세가 새로고침 전까지
    // 「시작 중」으로 남는다(WP-1913 리뷰 반려 ①·③). setting 행의 generation 은 이 갱신에서 바뀌지 않으므로
    // 계산에 쓰는 값도 before 과 같다 — 갱신 전 값은 그 행을 통째로 넘기는 Row 오버로드로 읽는다(리뷰 후속 ④).
    String visibleBefore = AgentRuntimeStatusResolver.currentPaneBlocked(before);
    String visibleAfter =
        AgentRuntimeStatusResolver.currentPaneBlocked(
            nextMessage,
            nextBlockedGeneration,
            AgentRuntimeStatusResolver.expectedPaneBlockGeneration(
                nextBlockedGeneration,
                before.generation(),
                before.observedGeneration(),
                before.applyMode() != ApplyMode.NOW),
            nextBlockedAt,
            before.startedAt(),
            nextBlockedPod,
            basisAfter);
    // 같은 메시지의 거듭된 보고(진입점 재시도)는 보이는 값이 그대로라 알리지 않는다(변경 알림 계약: 바뀐 것이 없으면 보지 않는다).
    // 합쳐 쓴 AI 상태가 바뀐 경우(WP-1969)도 같은 한 번의 알림이다.
    boolean stateChanged = blocked && VisibleRuntimeState.of(before).differsFrom(merged);
    // 판정이 바뀐 경우(WP-2000)도 같은 한 번의 알림이다.
    if (!Objects.equals(visibleBefore, visibleAfter) || stateChanged || decisionChanged) {
      changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, userId, null);
    }
  }

  /**
   * 받아들인 BLOCKED 뒤에 칸을 다시 합쳐 쓴 행을 돌려준다(WP-1969).
   *
   * <p>컨테이너만 재시작해 새 컨테이너가 시작에 실패하면 BLOCKED 만 오고 칸 보고는 오지 않는다. 그래서 올라간 Pod 시작으로 앞 컨테이너의 WORKING 칸을
   * 빼지 않으면 AI 가 영영 작업 중으로 보이고 「쉴 때 적용」 설정이 나가지 않는다.
   *
   * <p>관찰한 Pod 시작(started_at)이 없으면 시각 없는 옛 칸은 가를 수 없다. 이때 AI 상태까지 비어 있으면 합쳐 봐야 이미 지운 상태가 그 칸에서 되살아날
   * 뿐이라, 합치지 않고 차단을 쓴 뒤의 행을 읽는다. AI 상태가 남아 있으면 시각 있는 옛 칸을 빼야 하므로 합친다.
   */
  private Row mergeSlotsOnBlock(
      long userId, Row before, OffsetDateTime basisAfter, OffsetDateTime now) {
    if (before.startedAt() == null && before.agentState() == null) {
      return settings.find(userId).orElse(before);
    }
    OffsetDateTime current =
        AgentRuntimeSlotRepository.currentPodStart(before.startedAt(), basisAfter);
    return slotWriter.write(
        userId,
        slots.findAll(userId),
        before.observedPodUid(),
        before.startedAt(),
        current,
        now,
        null);
  }

  /**
   * 보고의 generation 을 받을지(WP-1969) — 없거나 지금 generation 이면 받는다. 그 밖에는 AI 가 켜져 있고(RUN) 쉴 때 적용 중이며 보고가
   * 지금 도는 Pod 의 generation(관찰 generation)일 때만 아래대로 받는다. 바로 적용(NOW)이면 이미 지금 적용이 정해졌고, 꺼졌거나 다시 시작 중이면
   * 끝나는 Pod 의 늦은 쓰기라 WP-1913 대로 버린다.
   *
   * <ul>
   *   <li>BLOCKED — 저장된 차단이 없거나 그보다 새롭지 않을 때.
   *   <li>OK — 저장된 차단이 바로 그 Pod 의 것일 때({@link AgentRuntimeStatusResolver#blocksRunningPod}). 받지 않으면
   *       회복한 Pod 의 차단이 남아 첫 상태 보고 전에 {@link RolloutPolicy} 가 그 Pod 를 다시 띄운다.
   * </ul>
   */
  private static boolean acceptableGeneration(Long reported, boolean blocked, Row before) {
    if (reported == null || reported == before.generation()) return true;
    if (!reported.equals(before.observedGeneration())) return false;
    if (before.desired() != Desired.RUN || before.applyMode() != ApplyMode.IDLE) return false;
    if (!blocked) return AgentRuntimeStatusResolver.blocksRunningPod(before);
    return before.paneBlockedGeneration() == null || before.paneBlockedGeneration() <= reported;
  }

  /**
   * 차단 메시지의 제어 문자(개행·탭·NUL 등)를 공백으로 바꾸고 앞뒤 공백을 뗀다(WP-1913) — 진입점은 로그 한 줄을 그대로 실으므로 개행이 섞이면 관리자 화면의
   * 사유 한 줄이 여러 줄로 갈라지고, NUL 은 PostgreSQL 이 거절해 보고 전체가 실패한다(테스트가 막는 바). gw-boot 의 {@code tr}·{@code
   * sed} 와 같은 취향을 서버가 마지막으로 방어한다 — 클라이언트 정제를 믿지 않고, 그 밖의 남은 제어 문자도 같은 방식으로 정리한다.
   *
   * @param message 보고 온 원문 — null 은 그대로 null(OK 보고에는 message 가 없다)
   * @return 제어 문자를 공백으로 바꾸고 앞뒤를 뗀 값(길이는 원문 이하 — 공백 치환은 1:1, trim 은 줄이기만 한다)
   */
  private static String sanitizeMessage(String message) {
    if (message == null) return null;
    StringBuilder sanitized = new StringBuilder(message.length());
    for (int i = 0; i < message.length(); i++) {
      char c = message.charAt(i);
      sanitized.append(Character.isISOControl(c) ? ' ' : c);
    }
    return sanitized.toString().trim();
  }
}
