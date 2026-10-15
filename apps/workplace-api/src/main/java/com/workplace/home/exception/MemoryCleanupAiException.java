package com.workplace.home.exception;

import com.workplace.global.outbound.AgentOutageGuard;
import org.springframework.web.client.HttpStatusCodeException;

/**
 * ai-agent 메모리 정리 요청 실패(WP-385) — HTTP 오류·연결 실패·시간 초과를 감싼다. 예약 작업이 이 판정으로 "연속 장애면 회차 중단"과 "세션 실패
 * 횟수"를 가른다. WP-386 공용 추출(SessionCleanupParticipant)도 일시 장애를 이 예외로 알린다.
 */
public class MemoryCleanupAiException extends RuntimeException {

  public MemoryCleanupAiException(String message, Throwable cause) {
    super(message, cause);
  }

  /**
   * ai-agent 가 정리를 받을 수 없다 — 연결·읽기 실패 또는 503({@link AgentOutageGuard#isAgentDown}), 그리고 404. 정리 경로는
   * 400·200·502 만 내므로 404 는 경로가 아직 없는 구 ai-agent 다(새 API 를 먼저 올린 배포 구간): 그 대화 탓으로 세면 3회 뒤 정리를 영구히
   * 잃는다. 세지 않고 연속이면 회차를 멈춘다. WP-386 참여자가 같은 예외로 알리는 404 도 같은 규칙을 따른다.
   */
  public boolean isAgentDown() {
    return AgentOutageGuard.isAgentDown(getCause())
        || (getCause() instanceof HttpStatusCodeException h && h.getStatusCode().value() == 404);
  }

  /** 요청은 닿았고 응답만 늦었다(읽기 시간 초과) — 그 세션만의 실패로도 센다. */
  public boolean isReadTimeout() {
    return AgentOutageGuard.isReadTimeout(getCause());
  }
}
