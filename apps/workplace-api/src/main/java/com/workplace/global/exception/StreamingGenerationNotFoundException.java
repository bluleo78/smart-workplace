package com.workplace.global.exception;

/** 존재하지 않는(이미 완료·타임아웃되었거나 애초에 없던) correlationId 로 취소를 시도했을 때. */
public class StreamingGenerationNotFoundException extends RuntimeException {
  public StreamingGenerationNotFoundException(String correlationId) {
    super("생성 요청을 찾을 수 없습니다: " + correlationId);
  }
}
