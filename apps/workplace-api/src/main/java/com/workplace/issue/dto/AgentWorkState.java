package com.workplace.issue.dto;

import java.util.List;

/** AI 작업 상태 상수(WP-377). 문자열 컬럼이라 enum 대신 상수 + 급한 순위로 다룬다. */
public final class AgentWorkState {
  public static final String WORKING = "WORKING";
  public static final String WAITING = "WAITING";
  public static final String REVIEW = "REVIEW";
  public static final String BLOCKED = "BLOCKED";
  public static final String PAUSED = "PAUSED";

  /** 보고 입력 전용 — 저장 상태가 아니라 ended_at 설정을 뜻한다. */
  public static final String ENDED = "ENDED";

  /** 진행 중 상태를 급한 순(사람이 할 일 먼저)으로. 목록 정렬·대표 작업 선택에 쓴다. */
  public static final List<String> ACTIVE = List.of(WAITING, REVIEW, BLOCKED, WORKING, PAUSED);

  /** 작업이 없는 이슈의 순위 — 목록 맨 뒤. */
  public static final int NO_WORK_RANK = 9;

  private AgentWorkState() {}

  /** 급한 순위(0 이 가장 급함). 모르는 값·null 은 맨 뒤. */
  public static int rank(String state) {
    int i = state == null ? -1 : ACTIVE.indexOf(state);
    return i < 0 ? NO_WORK_RANK : i;
  }

  /** 진행 중(저장 가능한) 상태인지. ENDED·null·모르는 값은 false. */
  public static boolean isActive(String state) {
    return state != null && ACTIVE.contains(state);
  }
}
