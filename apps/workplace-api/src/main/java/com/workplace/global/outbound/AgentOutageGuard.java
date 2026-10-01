package com.workplace.global.outbound;

import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;

/**
 * ai-agent 를 반복 호출하는 배치 1회 동안 "agent 연속 불가" 횟수를 세는 카운터(WP-166) — 상한에 닿으면 {@link #tripped()} 가 true
 * 가 되고 배치는 남은 대상을 건너뛴다.
 *
 * <p>왜: ai-agent 가 재기동 중(약 20~30초)이면 배치가 대상마다 같은 실패를 쌓아 대상 수만큼 오류 로그를 남긴다. 반대로 첫 실패에서 멈추면 읽기
 * 타임아웃(느린 LLM 한 건)만으로 회차 전체를 건너뛴다. 그래서 "agent 가 응답하지 않은 실패"가 연속 {@value
 * #MAX_CONSECUTIVE_UNAVAILABLE}회일 때만 멈춘다. agent 를 실제로 부르지 않은 대상(후보 없음·빈 본문 등)은 판단 근거가 아니므로 어느 쪽도
 * 기록하지 않는다.
 *
 * <p>여러 도메인 배치(우선순위 분류·메일 선제 분석·메일 재분석)가 같은 기준을 쓰도록 global 에 둔다. 배치 스레드 하나 안에서만 쓴다(스레드 안전하지 않음).
 */
public final class AgentOutageGuard {

  /** agent 불가가 이만큼 연속되면 멈춘다. */
  public static final int MAX_CONSECUTIVE_UNAVAILABLE = 3;

  private int streak;

  /** agent 가 응답했다(성공 또는 응답을 받은 뒤의 실패) — 연속 횟수를 리셋한다. */
  public void recordResponse() {
    streak = 0;
  }

  /**
   * agent 불가 1회를 기록한다.
   *
   * @return 이번 기록으로 상한에 닿았으면 true — 호출부가 멈춘다
   */
  public boolean recordUnavailable() {
    return ++streak >= MAX_CONSECUTIVE_UNAVAILABLE;
  }

  /** 상한에 닿아 배치를 멈춰야 하는지. */
  public boolean tripped() {
    return streak >= MAX_CONSECUTIVE_UNAVAILABLE;
  }

  /**
   * HTTP 클라이언트 예외가 ai-agent 쪽 일시 장애인지 — 연결·읽기 실패({@link ResourceAccessException}) 또는 503. 그
   * 외(4xx·파싱 실패)는 agent 가 응답한 그 요청만의 실패다. 각 도메인 예외의 원인(cause)을 넘겨 판정한다.
   */
  public static boolean isAgentDown(Throwable clientError) {
    return clientError instanceof ResourceAccessException
        || (clientError instanceof HttpStatusCodeException h && h.getStatusCode().value() == 503);
  }

  /** 로그용 한 줄 원인 — 래핑 예외면 원인을, 원인이 없으면(503 전용 예외 등) 자신을 문자열로. 스택은 남기지 않는다. */
  public static String describe(Throwable e) {
    return e.getCause() != null ? e.getCause().toString() : e.toString();
  }
}
