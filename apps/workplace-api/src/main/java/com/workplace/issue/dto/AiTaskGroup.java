package com.workplace.issue.dto;

/**
 * AI 위임 작업 행의 묶음 정보(WP-375 §3.6, WP-1211). /me/ai-tasks 행에만 싣는다 — 모든 행이 묶음 하나에 든다: 같은 프로젝트 에픽 묶음(이슈
 * 자신이 에픽이거나 부모가 같은 프로젝트 에픽)이거나, 프로젝트마다 하나인 「에픽 없음」 묶음(epicNumber null).
 *
 * @param epicNumber 묶음 에픽 번호(같은 프로젝트). 「에픽 없음」 묶음이면 null
 * @param size 필터 적용 후 이 묶음의 행 수(에픽 자신 행 포함) — 화면 머리 줄의 「n건」
 * @param epicChildCount 에픽의 하위 수(이슈 목록 └ n/m 과 같은 기준). 「에픽 없음」이면 0
 * @param epicChildDoneCount 에픽의 종료(완료·취소) 하위 수. 「에픽 없음」이면 0
 */
public record AiTaskGroup(
    Integer epicNumber, int size, int epicChildCount, int epicChildDoneCount) {

  /** 프로젝트의 「에픽 없음」 묶음 — 에픽 번호·하위 진행이 없다. */
  public static AiTaskGroup noEpic(int size) {
    return new AiTaskGroup(null, size, 0, 0);
  }
}
