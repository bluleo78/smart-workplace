package com.workplace.home.service;

/**
 * 「AI가 정리함」 기록의 동작(WP-385) — DB ck_ai_memory_change_action 과 같은 집합. ADDED 새로 기억함, MERGED 여러 개를 하나로,
 * UPDATED 고침, FORGOTTEN 대화와 맞지 않아 지움, DECAYED 90일 동안 쓰지 않아 지움.
 */
public enum AiMemoryChangeAction {
  ADDED,
  MERGED,
  UPDATED,
  FORGOTTEN,
  DECAYED
}
