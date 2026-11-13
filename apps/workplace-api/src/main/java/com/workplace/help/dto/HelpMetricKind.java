package com.workplace.help.dto;

/** 도움말 지표 종류(WP-1512) — 열람·검색 실패·AI 근거 없음. DB 의 kind 컬럼 값(name())과 1:1. */
public enum HelpMetricKind {
  /** 화면에서 도움말을 연 횟수. */
  OPEN,
  /** 도움말 검색 결과가 비었던 검색어. */
  SEARCH_MISS,
  /** AI 가 매뉴얼에서 근거를 찾지 못한 질문(검색어로 요약). */
  AI_GAP
}
