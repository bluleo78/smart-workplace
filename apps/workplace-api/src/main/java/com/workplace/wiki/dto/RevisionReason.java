package com.workplace.wiki.dto;

/**
 * 노트 리비전(버전 기록) 스냅샷 사유(WP-297, 스펙 §6.1) — wiki_revision.reason 에 이름 그대로 저장한다. 이 사유가 생기기 전의 행은
 * reason 이 NULL 이다.
 */
public enum RevisionReason {
  /** 5분 넘게 조용했다가 편집이 다시 시작될 때 — 직전 편집 묶음의 마지막 판. */
  SESSION,
  /** 쉬지 않고 이어지는 편집 중 30분마다 — 긴 편집 세션의 중간 판. */
  PERIODIC,
  /** AI 가 본문을 적용하기 직전 — 되돌리기 대비(✦ 귀속은 ai_actor_id). */
  AI,
  /** 이전 판으로 복원하기 직전 — 복원을 되돌릴 수 있게. */
  RESTORE
}
