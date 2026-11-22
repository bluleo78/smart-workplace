package com.workplace.agentruntime.dto;

/**
 * 저장했지만 아직 Pod 에 닿지 않은 설정이 언제 닿는지(WP-2000) — {@code RolloutPolicy} 의 판정을 화면이 그대로 읽게 응답에 싣는다. 화면이 같은
 * 규칙을 따로 계산하면 서버와 어긋나므로 판정은 서버 한 곳이다. 반영할 설정이 없거나 꺼져 있으면 응답에서 null.
 */
public enum PendingApply {
  /** 지금 적용된다 — runner 가 Pod 를 바로 다시 만든다. */
  NOW,
  /** AI 가 하던 일을 마치고 쉴 때까지 지금 Pod 를 둔다. */
  AT_IDLE
}
