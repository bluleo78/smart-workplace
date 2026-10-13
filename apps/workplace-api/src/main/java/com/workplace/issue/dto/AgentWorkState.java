package com.workplace.issue.dto;

import java.util.List;
import java.util.Set;

/**
 * AI 작업 상태 상수(WP-377). 상태 어휘는 A2A 1.0 TaskState 에 맞춘다(이슈 = contextId, agent_work 한 행 = task). 문자열
 * 컬럼이라 enum 대신 상수 + 급한 순위로 다룬다.
 *
 * <p>진행(ended_at IS NULL) 7종과 종료(ended_at 설정) 4종으로 나뉜다. REVIEW·BLOCKED·PAUSED 는 A2A 에 없는 플랫폼 확장이다.
 */
public final class AgentWorkState {
  // 진행 상태
  public static final String SUBMITTED = "SUBMITTED";
  public static final String WORKING = "WORKING";
  public static final String INPUT_REQUIRED = "INPUT_REQUIRED";
  public static final String AUTH_REQUIRED = "AUTH_REQUIRED";
  public static final String REVIEW = "REVIEW";
  public static final String BLOCKED = "BLOCKED";
  public static final String PAUSED = "PAUSED";

  // 종료 상태 — 작업 행이 끝났음(ended_at 설정)을 뜻한다.
  public static final String COMPLETED = "COMPLETED";
  public static final String FAILED = "FAILED";
  public static final String CANCELED = "CANCELED";
  public static final String REJECTED = "REJECTED";

  /** 진행 중 상태를 급한 순(사람이 할 일 먼저)으로. 목록 정렬·대표 작업 선택에 쓴다. */
  public static final List<String> ACTIVE =
      List.of(INPUT_REQUIRED, AUTH_REQUIRED, REVIEW, BLOCKED, WORKING, PAUSED, SUBMITTED);

  /** 종료 상태 집합 — 보고로 작업을 끝낼 때 쓰는 값. */
  public static final Set<String> TERMINAL = Set.of(COMPLETED, FAILED, CANCELED, REJECTED);

  /** 작업이 없는 이슈의 순위 — 목록 맨 뒤. */
  public static final int NO_WORK_RANK = 9;

  private AgentWorkState() {}

  /** 급한 순위(0 이 가장 급함). 모르는 값·null·종료 상태는 맨 뒤. */
  public static int rank(String state) {
    int i = state == null ? -1 : ACTIVE.indexOf(state);
    return i < 0 ? NO_WORK_RANK : i;
  }

  /** 진행 중 상태인지. 종료 상태·null·모르는 값은 false. */
  public static boolean isActive(String state) {
    return state != null && ACTIVE.contains(state);
  }

  /** 종료 상태인지. 진행 상태·null·모르는 값은 false. */
  public static boolean isTerminal(String state) {
    return state != null && TERMINAL.contains(state);
  }
}
