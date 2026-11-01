package com.workplace.agentruntime.service;

import com.workplace.agentruntime.dto.AgentState;
import com.workplace.agentruntime.dto.AgentStatusReportRequest;
import com.workplace.agentruntime.dto.AgentStatusReportResponse;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.outbound.AgentRuntimeChangeNotifier;
import com.workplace.agentruntime.outbound.AgentRuntimeDesiredChanged;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.AgentStateUpdate;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.auth.service.AgentApiKeyService;
import com.workplace.global.realtime.ResourceChangedEvent;
import com.workplace.global.tenant.TenantContext;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI 상태 보고 서비스(WP-1250) — Works 가 띄운 AI 가 보고한 상태를 실행 설정의 agent_* 칸에 남기고, 그 AI 가 계속 일할지(RUN)·새 이슈를
 * 집지 말지(DRAIN)·곧 다시 띄워질지(RESTART)를 돌려준다. 호출자가 AI 인지는 컨트롤러가 인증 권한으로 먼저 확인한다.
 *
 * <p>실행 설정이 없는 AI(외부에서 돌리는 AI)는 아무것도 저장하지 않고 늘 RUN 이다 — 외부 AI 의 동작을 바꾸지 않는다. 테넌트가 정해지지 않은 키 인증(여러
 * 워크스페이스에 속한 AI 가 워크스페이스를 밝히지 않음)도 같다.
 *
 * <p>쉬는 중(IDLE)으로 막 바뀌었는데 아직 반영되지 않은 generation 이 있으면 변경 이벤트를 내 runner 가 다시 조회하게 한다 — 그때 {@link
 * RolloutPolicy} 가 지금 적용으로 판정해 미뤄 둔 교체(설정 변경·키 교체)가 적용된다. 이미 쉬는 중이던 AI 의 거듭된 IDLE 보고는 이벤트를 다시 내지
 * 않는다.
 *
 * <p>보고로 화면에 보이는 AI 상태(상태·이슈 키·다음 확인 시각)가 달라졌을 때만 관리자 화면에 알린다(WP-1254) — 같은 내용의 거듭된 보고는 알리지 않는다.
 */
@Service
@Transactional
@RequiredArgsConstructor
public class AgentStatusReportService {

  private final AgentRuntimeSettingRepository settings;
  private final AgentLocationService locationService;
  private final AgentApiKeyService agentKeys;
  private final ApplicationEventPublisher events;
  private final AgentRuntimeChangeNotifier changeNotifier;

  /**
   * 상태 보고 처리. 순서: 테넌트가 없으면 RUN → agent_* 칸 저장(설정 행이 없으면 RUN) → 쉬는 중으로 막 바뀌었고 교체 대기면 이벤트 → 원하는 상태
   * 계산.
   */
  public AgentStatusReportResponse report(long userId, AgentStatusReportRequest req) {
    Long tenantId = TenantContext.get();
    if (tenantId == null) return new AgentStatusReportResponse(AgentStatusReportResponse.RUN);
    Optional<AgentStateUpdate> updated =
        settings.updateAgentState(userId, req.state(), req.issueKey(), req.nextCheckAt());
    if (updated.isEmpty()) return new AgentStatusReportResponse(AgentStatusReportResponse.RUN);
    Row row = updated.get().row();
    boolean becameIdle =
        req.state() == AgentState.IDLE
            && !AgentState.IDLE.name().equals(updated.get().before().agentState());
    if (becameIdle && row.hasUnappliedGeneration()) publishChanged(tenantId, row.locationId());
    if (updated.get().before().differsFrom(row)) {
      changeNotifier.agentChanged(ResourceChangedEvent.OP_UPDATED, userId, null);
    }
    return new AgentStatusReportResponse(desiredFor(row, req.generation(), tenantId));
  }

  /**
   * 원하는 상태 — 꺼졌으면 DRAIN(지워지는 Pod 가 새 이슈를 집지 않게 하는 안전장치 — 끄기 자체는 runner 가 바로 한다). 보고한 generation 이
   * 설정보다 뒤처졌으면 runner 의 {@code applyNow} 와 같은 판정({@link RolloutPolicy})이 지금 적용이면 RESTART, 아니면
   * DRAIN(쉬면 runner 가 다시 띄운다). 그 밖은 RUN. 키 사슬은 뒤처졌을 때만 읽는다.
   *
   * @param row 이번 보고를 쓴 뒤의 행(쉬는 중 보고면 이미 IDLE)
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
