package com.workplace.agentruntime.dto;

/**
 * AI 가 스스로 보고하는 상태(WP-1250) — Works 가 띄운 AI 가 상태 보고로 알린다. DB(agent_runtime_setting.agent_state)에는
 * 이름 문자열로 저장하고, 쉬는 중(IDLE)이면 미뤄 둔 교체를 지금 적용할 수 있다({@code applyNow}).
 */
public enum AgentState {
  /** 쉬는 중 — 다음 확인을 기다리거나 고를 일을 찾는 중. */
  IDLE,
  /** 이슈를 처리하는 중. */
  WORKING,
  /** 막혀 있음. */
  BLOCKED
}
