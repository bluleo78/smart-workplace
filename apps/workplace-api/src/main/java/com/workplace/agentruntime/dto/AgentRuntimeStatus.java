package com.workplace.agentruntime.dto;

/**
 * AI 실행 상태(WP-1247) — 원하는 상태(desired·generation)와 runner 가 보고한 관찰 상태(observedGeneration·phase)를 합쳐
 * 화면에 보일 한 가지 상태로 정한 값. 계산 규칙은 {@code AgentRuntimeStatusResolver}.
 */
public enum AgentRuntimeStatus {
  /** 꺼져 있음. */
  OFF,
  /** 켜는 중(아직 돌고 있다는 보고가 없음). */
  STARTING,
  /** 켜져 있고 최신 설정을 반영함. */
  RUNNING,
  /** 켜져 있지만 바뀐 설정을 아직 반영하지 않음(적용 대기). */
  APPLY_PENDING,
  /** 끄는 중. */
  STOPPING,
  /** 실행 실패. */
  FAILED
}
