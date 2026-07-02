package com.workplace.home.exception;

/** ai-agent 우선순위 분류 요청 실패(HTTP 오류·타임아웃·빈 응답 등)를 감싸는 예외. */
public class PriorityAiException extends RuntimeException {
  public PriorityAiException(String message, Throwable cause) {
    super(message, cause);
  }
}
