package com.workplace.auth.exception;

/** Task10 — ai-agent 모델 프로브(POST /models/list) 호출 실패(IO/4xx/5xx) → 502. */
public class AssistantModelsProbeException extends RuntimeException {
  public AssistantModelsProbeException(String message, Throwable cause) {
    super(message, cause);
  }

  public AssistantModelsProbeException(String message) {
    super(message);
  }
}
