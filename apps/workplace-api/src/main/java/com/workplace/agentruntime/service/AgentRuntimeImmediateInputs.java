package com.workplace.agentruntime.service;

import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import java.util.Collection;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 「바로 적용」 입력 변경의 공통 처리(WP-1515) — 실행 설정은 그대로인데 runner 가 받는 입력(AI 계정 키 원문·기존 연결·저장소 토큰)이 바뀌어 지금 Pod
 * 를 다시 만들어야 하는 경우를 한곳에서 다룬다.
 *
 * <p>runner 는 「쉴 때 적용」으로 미뤄 둔 generation 이 있는 동안 비밀값 버전이 바뀌어도 Pod 를 갈지 않는다(미뤄 둔 generation 과 함께 쉴 때
 * 간다). 그래서 바로 적용해야 할 입력이 바뀌면 미뤄 둔 generation 을 NOW 로 돌려야 한다({@link
 * AgentRuntimeSettingRepository#markPendingApplyNow}). 다시 만들면 미뤄 둔 설정·계정까지 최신 generation 으로 뜬다. 키
 * 원문 교체·저장소 토큰·기존 연결 등록/회수·「지금 적용」이 저마다 규칙을 되풀이하지 않게 여기 둔다.
 *
 * <p>잠금 순서: NOW 표시는 실행 설정 행을 고치므로 잠근다. 계정 행도 고치는 경로(키 원문 교체)는 계정 행보다 먼저 {@link #markApplyNow} 를 불러
 * 「설정 행 → 계정 행」 순서를 지킨다(묶기와 같은 순서 — 반대 순서면 동시 묶기와 교착한다).
 */
@Component
@RequiredArgsConstructor
public class AgentRuntimeImmediateInputs {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeTransitions transitions;

  /**
   * 켜져 있고 미뤄 둔 generation 이 있는 AI 들의 apply_mode 를 NOW 로 돌린다(한 문장). 알림은 내지 않는다 — 다른 행을 고치기 전에 설정 행부터
   * 잠가야 하는 호출자(키 원문 교체)가 쓰고, 알림은 고친 뒤 {@link #notifyChanged} 로 낸다.
   *
   * @return NOW 로 돌린 행 수
   */
  public int markApplyNow(Collection<Long> agentUserIds) {
    return settings.markPendingApplyNow(agentUserIds);
  }

  /**
   * 입력이 바뀐 AI 들을 알린다 — AI 마다 지금 실행 설정을 읽어 켜져 있으면 실제 위치의 runner 에게, 관리자 화면에는 「바뀜」을({@link
   * AgentRuntimeTransitions#inputsChanged}). 실행 설정이 없으면 화면 알림만. 알림은 커밋 뒤에 나간다.
   */
  public void notifyChanged(Collection<Long> agentUserIds, Long actorId) {
    for (Long agentId : agentUserIds) {
      transitions.inputsChanged(
          agentId,
          settings.find(agentId).map(AgentRuntimeTransitions.State::of).orElse(null),
          actorId);
    }
  }

  /**
   * 바로 적용 입력 변경의 기본 흐름 — 미뤄 둔 generation 을 NOW 로 돌리고({@link #markApplyNow}) 알린다({@link
   * #notifyChanged}).
   */
  public void changed(Collection<Long> agentUserIds, Long actorId) {
    markApplyNow(agentUserIds);
    notifyChanged(agentUserIds, actorId);
  }
}
