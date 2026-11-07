package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentStatusReportRequest;
import com.workplace.agentruntime.dto.AgentStatusReportResponse;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.repository.VisibleRuntimeState;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
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
 * 보고는 이벤트를 다시 내지 않는다.
 *
 * <p>보고로 화면에 보이는 AI 상태(상태·이슈 키·다음 확인 시각)가 달라졌을 때만 관리자 화면에 알린다(WP-1254) — 같은 내용의 거듭된 보고는 알리지 않는다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentStatusReportService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeSlotRepository slots;
  private final AgentSlotStateWriter slotWriter;
  private final AgentLocationService locationService;
  private final AgentApiKeyService agentKeys;
  private final ApplicationEventPublisher events;
  private final AgentRuntimeChangeNotifier changeNotifier;

  /**
   * 상태 보고 처리. 순서: 테넌트가 없으면 RUN → 설정 행을 잠가 읽음(없으면 RUN — 칸도 저장하지 않는다) → 칸 저장 → 옛 Pod 칸 정리 → 모든 칸을 합쳐
   * agent_* 칸에 씀 → 합친 상태가 쉬는 중으로 막 바뀌었고 교체 대기면 이벤트 → 화면 값이 바뀌었으면 알림 → 원하는 상태 계산.
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
    slots.upsert(userId, key, req.state(), req.issueKey(), req.nextCheckAt(), now);
    // 옛 Pod 칸은 빼고(있을 때만 지움), 오래 보고가 끊긴 칸(죽은 칸)도 빼고 합쳐 쓴다. 방금 보고한 칸은 옛 Pod 거르기에서 늘 제외되고 보고
    // 시각이 지금이라 오래되지도 않으므로 늘 남는다 — 그래서 agent_reported_at(살아 있는 칸의 가장 늦은 보고 시각)도 지금이다.
    Row row = slotWriter.write(userId, slots.findAll(userId), before.startedAt(), now, key);

    // 「쉬는 중으로 막 바뀜」은 합친 상태로 판정한다 — 모든 칸이 쉬게 된 보고에서만 이벤트가 나간다.
    boolean becameIdle = row.isIdle() && !before.isIdle();
    if (becameIdle && row.hasUnappliedGeneration()) publishChanged(tenantId, row.locationId());
    if (VisibleRuntimeState.of(before).differsFrom(row)) {
      changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, userId, null);
    }
    return new AgentStatusReportResponse(desiredFor(row, req.generation(), tenantId));
  }

  /** 요청의 칸 → 저장 칸 키. 없거나 빈 값은 {@code ''}(옛 단일 칸), 그 밖은 대문자 — 'wp' 와 'WP' 를 같은 칸으로. */
  static String slotKeyOf(String slot) {
    return slot == null ? "" : slot.toUpperCase(Locale.ROOT);
  }

  /**
   * 원하는 상태 — 꺼졌으면 DRAIN(지워지는 Pod 가 새 이슈를 집지 않게 하는 안전장치 — 끄기 자체는 runner 가 바로 한다). 보고한 generation 이
   * 설정보다 뒤처졌으면 runner 의 {@code applyNow} 와 같은 판정({@link RolloutPolicy})이 지금 적용이면 RESTART, 아니면
   * DRAIN(쉬면 runner 가 다시 띄운다). 그 밖은 RUN. 키 사슬은 뒤처졌을 때만 읽는다.
   *
   * @param row 이번 보고를 합쳐 쓴 뒤의 행(모든 칸이 쉬면 IDLE — 그때만 쉴 때 적용이 지금 적용으로 바뀐다)
   */
  private String desiredFor(Row row, Long reportedGeneration, long tenantId) {
    if (row.desired() == Desired.STOP) return AgentStatusReportResponse.DRAIN;
    if (reportedGeneration == null || reportedGeneration >= row.generation()) {
      return AgentStatusReportResponse.RUN;
    }
    RolloutPolicy.Decision decision =
        RolloutPolicy.decide(
            row, agentKeys.managedChain(row.agentUserId(), tenantId), OffsetDateTime.now());
    return decision == RolloutPolicy.Decision.NOW
        ? AgentStatusReportResponse.RESTART
        : AgentStatusReportResponse.DRAIN;
  }

  /** 실제 위치(지정 위치 ?? 기본 위치)의 runner 에 다시 조회하라고 알린다. 위치가 하나도 없으면 알릴 곳이 없다. */
  private void publishChanged(long tenantId, Long locationId) {
    Long effective = locationService.effectiveLocationId(locationId);
    if (effective != null) events.publishEvent(new AgentRuntimeDesiredChanged(tenantId, effective));
  }
}
