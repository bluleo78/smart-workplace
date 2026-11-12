package com.workplace.issue.overview.status;

/**
 * 프로젝트 상태 배지(WP-1479) — 화면 「순조로움」「주의」「위험」. 시스템이 {@link ProjectStatusRule} 로 정하고 AI 는 이 값을 받아 글만 쓴다.
 */
public enum StatusBadge {
  /** 순조로움 — 늦을 조짐이 없다(추이·예상 없음 포함). */
  ON_TRACK,
  /** 주의 — 예상 완료가 종료일보다 1~3일 늦다. */
  WARN,
  /** 위험 — 예상 완료가 종료일보다 4일 이상 늦다. */
  RISK
}
