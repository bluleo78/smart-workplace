package com.workplace.agentaccount.service;

import com.workplace.agentruntime.dto.ApplyMode;
import com.workplace.agentruntime.dto.Desired;
import com.workplace.agentruntime.repository.AgentRuntimeSettingRepository;
import com.workplace.agentruntime.service.AgentRuntimeImmediateInputs;
import com.workplace.agentruntime.service.AgentRuntimeTransitions;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 사람이 화면에서 AI 의 계정을 바꿨을 때의 runner 알림(WP-1448·WP-1515) — 고르기·바꾸기·풀기. 켜져 있는 AI 면 실행 설정 저장과 같게
 * generation 을 올리고 쉴 때 적용(IDLE)을 건다 — 일하는 중인 AI 를 끊지 않는다. 알림 규칙은 저장소 토큰 변경과 같은 {@link
 * AgentRuntimeTransitions#inputsChanged} 를 그대로 쓴다(폴링 5분을 기다리지 않게).
 *
 * <p>바로 적용 경로(키 원문 교체·기존 연결 등록 다리·자동 풀기)는 여기를 거치지 않고 {@link AgentRuntimeImmediateInputs} 를 직접 쓴다 —
 * generation 은 올리지 않고 미뤄 둔 generation 이 있으면 NOW 로 돌린다.
 *
 * <p>호출자는 쓰기 트랜잭션 안에서, 묶음을 쓴 뒤에 부른다 — 알림은 커밋 뒤에 나간다.
 */
@Component
@RequiredArgsConstructor
public class AgentAccountRuntimeNotifier {

  private final AgentRuntimeSettingRepository settings;
  private final AgentRuntimeTransitions transitions;

  /**
   * 사람이 화면에서 AI 의 계정을 고르기·바꾸기·풀기 했다(WP-1515) — 켜져 있으면 실행 설정 저장과 같게 generation+1·쉴 때 적용(IDLE)으로 미룬다.
   * 일하는 중인 AI 는 하던 작업을 마치고 쉴 때 새 계정으로 다시 뜨고, 쉬는 중이거나 한 번도 뜬 적 없으면 {@code RolloutPolicy} 가 바로 적용한다.
   * 걸려 있는 바로 적용(NOW, 「지금 적용」)은 {@link AgentRuntimeSettingRepository#bumpGenerationForRotation} 이
   * 지킨다.
   *
   * <p>꺼져 있거나 실행 설정이 없으면 Pod 가 없어 generation 을 올릴 까닭이 없다 — 화면 알림만 낸다. 바로 적용 경로({@link
   * AgentRuntimeImmediateInputs})의 NOW 표시는 desired=RUN 행만 고치므로 여기서는 부르지 않는다.
   *
   * <p>알림은 {@link AgentRuntimeTransitions#inputsChanged} 로 낸다 — 원하는 상태·위치가 그대로라 키 정리({@code
   * applyTransition})는 할 일이 없고, 켜진 AI 의 runner 알림과 관리자 화면 「바뀜」만 필요하다.
   *
   * @param setting 호출자가 이미 잠가 읽은 실행 설정 행(묶기·풀기가 {@code findForUpdate} 로 잠근 결과) — 다시 잠그지 않는다. 없으면
   *     empty
   */
  public void accountChangedByPerson(
      long agentId, Optional<AgentRuntimeSettingRepository.Row> setting, Long actorId) {
    if (setting.isEmpty() || setting.get().desired() != Desired.RUN) {
      transitions.inputsChanged(
          agentId, setting.map(AgentRuntimeTransitions.State::of).orElse(null), actorId);
      return;
    }
    settings.bumpGenerationForRotation(agentId, ApplyMode.IDLE);
    transitions.inputsChanged(agentId, AgentRuntimeTransitions.State.of(setting.get()), actorId);
  }
}
