package com.workplace.agentruntime.service;

import java.util.Collection;

/**
 * runner 관찰 보고에서 「지금 Pod 가 RUNNING 인 AI」를 AI 계정 쪽에 알리는 창구(WP-1449) — 그 AI 가 묶인 계정의 마지막 사용 시각을 올린다.
 * agentruntime 은 agentaccount 를 import 하지 않으므로({@code PodAccountSource} 와 같은 방향) 이 인터페이스를 여기 두고
 * agentaccount 가 구현한다.
 */
public interface AgentAccountUsageTouch {

  /**
   * 이 AI 들이 묶인 계정의 마지막 사용 시각을 지금으로 올린다. 1분 안쪽 재갱신은 건너뛴다. 실패는 호출자 트랜잭션을 망가뜨리지 않아야 한다(구현이 자기 경계 안에서
   * 되돌린다) — 호출자는 예외를 잡아 기록만 한다.
   *
   * @param agentUserIds RUNNING 으로 보고된 AI 사용자 id
   */
  void touchRunning(Collection<Long> agentUserIds);
}
