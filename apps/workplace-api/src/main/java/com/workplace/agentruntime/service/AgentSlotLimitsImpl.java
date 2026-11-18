package com.workplace.agentruntime.service;

import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository.Row;
import com.workplace.global.ai.AgentSlotLimits;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@link AgentSlotLimits} 구현(WP-1754) — 실행 설정 행들을 한 번에 읽어 {@link
 * AgentRuntimeSettingService#slotLimitOf} 규칙(덮어쓴 값 ?? 템플릿 기본 ?? 5)을 그대로 쓴다. 규칙을 여기서 다시 만들지 않는다.
 */
@Service
@RequiredArgsConstructor
public class AgentSlotLimitsImpl implements AgentSlotLimits {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeSettingService settingService;

  /** 요청한 모든 AI 를 담는다 — 설정 행이 없는 AI 는 {@link #DEFAULT}(호출한 쪽이 따로 기본값을 채우지 않게, WP-1754). */
  @Override
  @Transactional(readOnly = true)
  public Map<Long, Integer> limitsOf(Collection<Long> agentIds) {
    Map<Long, Integer> result = new HashMap<>();
    for (Long id : agentIds) {
      result.put(id, DEFAULT);
    }
    for (Row r : settings.findByAgentIds(agentIds)) {
      result.put(r.agentUserId(), settingService.slotLimitOf(r));
    }
    return result;
  }
}
