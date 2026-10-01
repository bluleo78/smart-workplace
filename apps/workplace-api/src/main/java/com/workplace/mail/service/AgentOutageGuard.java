package com.workplace.mail.service;

/**
 * 배치 1회 동안 ai-agent 연속 불가 횟수를 세는 카운터(WP-166) — 계정이 바뀌어도 이어서 센다.
 *
 * <p>왜 계정을 넘어 세나: 선제 분석은 계정마다 안 읽은 미분석 메일이 1~2통인 경우가 흔하다. 계정 안에서만 세면 agent 가 내려가 있어도 연속 횟수에 닿지 못해
 * 회차가 끝까지 돌며 메일마다 실패를 남긴다. agent 는 모든 계정이 공유하므로 회차 전체에서 센다. 단일 스레드(스케줄러 1회) 안에서만 쓴다.
 */
final class AgentOutageGuard {

  /** ai-agent 불가가 이만큼 연속되면 멈춘다 — MailReanalysisService 와 같은 기준. */
  static final int MAX_CONSECUTIVE_UNAVAILABLE = 3;

  private int streak;

  /** agent 가 응답했다(성공 또는 메일 단위 실패) — 연속 횟수를 리셋한다. */
  void recordResponse() {
    streak = 0;
  }

  /**
   * agent 불가 1회를 기록한다.
   *
   * @return 연속 횟수가 상한에 닿았으면 true — 호출부가 멈춘다
   */
  boolean recordUnavailable() {
    return ++streak >= MAX_CONSECUTIVE_UNAVAILABLE;
  }
}
