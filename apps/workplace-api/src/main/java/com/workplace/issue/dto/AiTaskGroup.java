package com.workplace.issue.dto;

/**
 * AI 위임 작업 행의 에픽 묶음 정보(WP-375 §3.6). /me/ai-tasks 행에만 싣는다 — 묶음 키가 에픽(이슈 자신이 에픽이거나 부모가 에픽)일 때만 있고,
 * 비에픽 단독 행은 null(JSON 생략).
 *
 * @param epicNumber 묶음 에픽 번호(같은 프로젝트)
 * @param size 필터 적용 후 이 묶음의 행 수(에픽 자신 행 포함) — 화면은 2 이상일 때만 머리를 그린다
 * @param epicChildCount 에픽의 하위 수(이슈 목록 └ n/m 과 같은 기준)
 * @param epicChildDoneCount 에픽의 종료(완료·취소) 하위 수
 */
public record AiTaskGroup(int epicNumber, int size, int epicChildCount, int epicChildDoneCount) {}
