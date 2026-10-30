package com.workplace.issue.dto;

import java.util.List;
import java.util.Set;

/**
 * AI 작업 상태 상수(WP-377). 상태 어휘는 A2A 1.0 TaskState 에 맞춘다(이슈 = contextId, agent_work 한 행 = task). 문자열
 * 컬럼이라 enum 대신 상수 + 급한 순위로 다룬다.
 *
 * <p>진행(ended_at IS NULL) 9종과 종료(ended_at 설정) 4종으로 나뉜다. REVIEW·BLOCKED·WAITING·SCHEDULED·PAUSED 는
 * A2A 에 없는 플랫폼 확장이다. SCHEDULED(다음 회차 대기, WP-450)는 AI 가 스스로 양보하고 정한 시각 이후에 이어 가는 상태다. WAITING(대기 중,
 * WP-1024)은 AI 몫을 마치고 다른 AI 의 차례(검토자 AI 의 PR 리뷰, 다른 AI 의 답 등)를 기다리는 상태다 — 사람의 할 일·알림에 잡히지 않고, 무엇을
 * 기다리는지는 note 에 적는다. 사람에게 묻거나 사람의 답·결정·확인을 기다리면 언제나 INPUT_REQUIRED 다(WP-1217 — AI 가 사람을 멘션한 대기 중
 * 보고는 서버가 답변 필요로 바꿔 저장한다).
 */
public final class AgentWorkState {
  // 진행 상태
  public static final String SUBMITTED = "SUBMITTED";
  public static final String WORKING = "WORKING";
  public static final String INPUT_REQUIRED = "INPUT_REQUIRED";
  public static final String AUTH_REQUIRED = "AUTH_REQUIRED";
  public static final String REVIEW = "REVIEW";
  public static final String BLOCKED = "BLOCKED";
  public static final String WAITING = "WAITING";
  public static final String SCHEDULED = "SCHEDULED";
  public static final String PAUSED = "PAUSED";

  // 종료 상태 — 작업 행이 끝났음(ended_at 설정)을 뜻한다.
  public static final String COMPLETED = "COMPLETED";
  public static final String FAILED = "FAILED";
  public static final String CANCELED = "CANCELED";
  public static final String REJECTED = "REJECTED";

  /** 진행 중 상태를 급한 순(사람이 할 일 먼저)으로. 목록 정렬·대표 작업 선택에 쓴다. */
  public static final List<String> ACTIVE =
      List.of(
          INPUT_REQUIRED,
          AUTH_REQUIRED,
          REVIEW,
          BLOCKED,
          WORKING,
          WAITING,
          SCHEDULED,
          PAUSED,
          SUBMITTED);

  /** 종료 상태 집합 — 보고로 작업을 끝낼 때 쓰는 값. */
  public static final Set<String> TERMINAL = Set.of(COMPLETED, FAILED, CANCELED, REJECTED);

  /**
   * 이슈 쓰기(MCP 수행 도구 헤더)로 다시 움직이기 시작했을 때 작업 중으로 되돌아가는 진행 상태. 검토 필요(REVIEW)는 검토 대기 중 PR 링크 코멘트 등이 흔해
   * 유지하고, 작업 중(WORKING)은 이미 그 상태라 제외한다. 다음 회차 대기(SCHEDULED)도 넣지 않는다 — 에픽 회차에서 하위를 만들다 에픽이 작업 중으로
   * 뒤집히면 매 회차 다시 집히므로, 재개는 AI 의 명시 보고로만 한다(WP-450). 대기 중(WAITING)도 넣지 않는다 — 상대를 기다리는 사이 이슈 챗 답·PR
   * 링크 같은 쓰기가 흔해, 쓰기마다 작업 중으로 뒤집히면 무엇을 기다리는지가 사라진다(WP-1024).
   */
  public static final Set<String> RESUMES_TO_WORKING =
      Set.of(INPUT_REQUIRED, AUTH_REQUIRED, BLOCKED, PAUSED, SUBMITTED);

  /** 사람의 입력·권한을 기다리며 멈춘 상태(A2A interrupted) — 이 상태의 note 는 질문·요청이라 벗어나면 낡는다. */
  public static final Set<String> INTERRUPT = Set.of(INPUT_REQUIRED, AUTH_REQUIRED);

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

  /** 사람의 입력·권한을 기다리는 중단 상태인지. 그 외·null·모르는 값은 false. */
  public static boolean isInterrupt(String state) {
    return state != null && INTERRUPT.contains(state);
  }

  /**
   * 명시 보고로 보낼 수 있는 상태인지 — 진행 상태에서 SUBMITTED(담당자 추가가 만드는 "시작 전" 이라 보고할 수 없다)를 뺀 것 + 종료 상태. 보고 요청 검증이
   * 이 목록 하나에서 나온다.
   */
  public static boolean isReportable(String state) {
    return isActive(state) && !SUBMITTED.equals(state) || isTerminal(state);
  }

  /** 종료 상태인지. 진행 상태·null·모르는 값은 false. */
  public static boolean isTerminal(String state) {
    return state != null && TERMINAL.contains(state);
  }
}
