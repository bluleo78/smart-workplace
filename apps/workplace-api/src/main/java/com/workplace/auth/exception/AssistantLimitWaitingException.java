package com.workplace.auth.exception;

import com.workplace.auth.service.AssistantLimitWaitService;
import java.time.Instant;

/**
 * 고른 비서 자격이 사용 한도 대기 중일 때 직접 요청(채팅·초안 등)을 즉시 거절하는 예외(WP-2108). GlobalExceptionHandler 가 503 + 「사용
 * 한도에 걸렸어요(HH:mm 이후 다시 시도해 주세요)」로 응답한다.
 */
public class AssistantLimitWaitingException extends RuntimeException {

  private final Instant until;

  public AssistantLimitWaitingException(Instant until) {
    super(AssistantLimitWaitService.waitingMessage(until, Instant.now()));
    this.until = until;
  }

  /** 대기가 풀리는 시각. */
  public Instant until() {
    return until;
  }
}
