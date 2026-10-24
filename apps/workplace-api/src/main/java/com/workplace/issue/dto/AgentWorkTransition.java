package com.workplace.issue.dto;

/**
 * AI 작업 보고 결과와 직전 상태(WP-913) — 「상태가 그 값으로 바뀌는 순간」에만 알림을 내려고 보고 쪽이 비교한다.
 *
 * @param view 갱신 뒤 작업
 * @param previousState 갱신 전 상태. 이번 보고로 새 행을 만들었으면 null
 */
public record AgentWorkTransition(AgentWorkView view, String previousState) {}
