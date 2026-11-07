package com.workplace.agentruntime.service;

import com.workplace.agentruntime.config.AgentRuntimeProperties;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSlotRepository.Slot;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 칸별 AI 상태를 다시 합쳐 실행 설정의 agent_* 칸에 쓰는 한 경로(WP-1409) — AI 상태 보고({@link AgentStatusReportService})와
 * runner 관찰 보고의 새 Pod 정리({@link RunnerDesiredStateService})가 같은 규칙으로 쓰게 한 곳에 둔다.
 *
 * <p>순서: 이미 읽은 칸에서 옛 Pod 칸({@link AgentRuntimeSlotRepository#isFromOldPod})을 빼고 — 뺀 것이 있을 때만 DB 에서도
 * 지운다 — 오래된 칸을 뺀 나머지를 {@link AgentSlotAggregate} 로 합쳐 쓴다. 호출자가 설정 행을 먼저 잠근 뒤 부른다(설정 행 → 칸 테이블 잠금
 * 순서).
 */
@Component
@RequiredArgsConstructor
public class AgentSlotStateWriter {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeSlotRepository slots;
  private final AgentRuntimeProperties properties;

  /**
   * 칸을 다시 합쳐 쓴다.
   *
   * @param agentSlots 그 AI 의 칸(이미 읽은 것 — 순서 무관)
   * @param podStartedAt 지금 Pod 의 시작 시각(모르면 null — 옛 Pod 칸을 가르지 않는다)
   * @param now 지금 시각(오래된 칸 판정 기준)
   * @param reportingSlotKey 방금 보고한 칸 키(보고 흐름) — 옛 Pod 칸으로 보지 않는다. runner 정리 흐름은 null
   * @return 쓴 뒤 행
   */
  public Row write(
      long agentUserId,
      List<Slot> agentSlots,
      OffsetDateTime podStartedAt,
      OffsetDateTime now,
      String reportingSlotKey) {
    // 방금 보고한 칸은 지금 Pod 에서 온 보고다 — 그런데 API 서버 시계가 runner·kubelet 시계보다 30초 넘게 늦으면 그 보고 시각(API 시계의
    // 지금)도 「시작 시각 − 30초」보다 앞서 옛 Pod 칸으로 걸린다. 그러면 보고마다 자기 칸을 지워 AI 상태가 영영 비므로, 시계와 상관없이 늘 남긴다
    // (메모리 거르기와 SQL 지우기 모두).
    List<Slot> current =
        agentSlots.stream()
            .filter(
                s ->
                    s.slotKey().equals(reportingSlotKey)
                        || !AgentRuntimeSlotRepository.isFromOldPod(s, podStartedAt))
            .toList();
    // 옛 Pod 칸이 있었을 때만 지운다 — 평소 보고는 DELETE 를 보내지 않는다.
    if (current.size() < agentSlots.size()) {
      slots.deleteReportedBeforePodStart(Map.of(agentUserId, podStartedAt), reportingSlotKey);
    }
    AgentSlotAggregate agg = AgentSlotAggregate.of(current, now, properties.slotStaleAfter());
    return settings.writeAgentState(
        agentUserId, agg.state(), agg.issueKeys(), agg.nextCheckAt(), agg.latestReportedAt());
  }
}
