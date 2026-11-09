package com.workplace.agentaccount.service;

import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.service.AgentRuntimeTransitions;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * AI 계정이 바뀌어 runner 가 받는 비밀값 버전이 달라졌을 때의 알림(WP-1448) — 묶기·옮기기·풀기·원문 교체. generation 은 올리지 않지만
 * desired 의 claude/login 버전이 바뀌므로, 켜져 있는 AI 면 그 실제 위치의 runner 에게 desired 를 다시 받아 가게 하고 관리자 화면에
 * 「바뀜」을 알린다. 규칙은 저장소 토큰 변경과 같은 {@link AgentRuntimeTransitions#inputsChanged} 를 그대로 쓴다(폴링 5분을 기다리지
 * 않게).
 *
 * <p>호출자는 쓰기 트랜잭션 안에서, 묶음·원문을 쓴 뒤에 부른다 — 알림은 커밋 뒤에 나간다.
 */
@Component
@RequiredArgsConstructor
public class AgentAccountRuntimeNotifier {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeTransitions transitions;

  /** AI 들의 runner 입력이 바뀌었다 — AI 마다 지금 실행 설정을 읽어 알린다(실행 설정이 없으면 화면 알림만). */
  public void inputsChanged(Collection<Long> agentUserIds, Long actorId) {
    for (Long agentId : agentUserIds) {
      transitions.inputsChanged(
          agentId,
          settings.find(agentId).map(AgentRuntimeTransitions.State::of).orElse(null),
          actorId);
    }
  }
}
