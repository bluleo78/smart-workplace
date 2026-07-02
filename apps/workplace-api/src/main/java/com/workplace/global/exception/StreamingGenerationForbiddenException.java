package com.workplace.global.exception;

/** 본인이 시작하지 않은 생성을 취소하려 할 때. */
public class StreamingGenerationForbiddenException extends RuntimeException {
  public StreamingGenerationForbiddenException(String correlationId) {
    super("본인이 시작한 생성만 취소할 수 있습니다: " + correlationId);
  }
}
