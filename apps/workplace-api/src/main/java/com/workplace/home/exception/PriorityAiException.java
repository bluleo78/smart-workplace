package com.workplace.home.exception;

import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.ResourceAccessException;

/** ai-agent 우선순위 분류 요청 실패(HTTP 오류·타임아웃·빈 응답 등)를 감싸는 예외. */
public class PriorityAiException extends RuntimeException {
  public PriorityAiException(String message, Throwable cause) {
    super(message, cause);
  }

  /**
   * ai-agent 일시 불가 여부 — 연결·읽기 실패({@link ResourceAccessException}) 또는 503 이면 agent 쪽 장애로 본다(재기동 중
   * 등). 그 외(4xx·파싱 실패)는 그 요청만의 실패다. 메일의 {@code MailAiException.isTransient()}·503 판정과 같은 규칙.
   */
  public boolean isTransient() {
    return getCause() instanceof ResourceAccessException
        || (getCause() instanceof HttpStatusCodeException h && h.getStatusCode().value() == 503);
  }
}
