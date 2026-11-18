package com.workplace.global.ai;

import java.util.Collection;
import java.util.Map;
import java.util.Set;

/**
 * AI 마다의 「동시 진행」 상한(WP-1754) — 실제 값(덮어쓴 값 ?? 템플릿 기본 ?? DEFAULT)은 agentruntime 모듈이 안다. 이슈 자리
 * 계산(AiAgentStatusService)이 agentruntime 을 직접 import 하지 않게 뒤집은 의존이다(AgentSlotCounter 와 같은 방식).
 */
public interface AgentSlotLimits {

  /** 실행 설정이 없거나 값을 모를 때의 상한. */
  int DEFAULT = 5;

  /** 허용되는 동시 진행 상한 값(WP-1754) — 상한 변경 검증과 템플릿 기본값 검증이 이 한 곳을 쓴다(DB CHECK 는 V315 에 따로 있다). */
  Set<Integer> ALLOWED = Set.of(1, 2, 3, 5);

  /**
   * AI 들의 실제 적용 상한. 요청한 모든 AI id 의 항목을 담는다 — 실행 설정 행이 없는 AI 는 {@link #DEFAULT}.
   *
   * @param agentIds AI 사용자 id 들
   */
  Map<Long, Integer> limitsOf(Collection<Long> agentIds);
}
