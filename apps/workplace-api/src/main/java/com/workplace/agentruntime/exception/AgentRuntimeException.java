package com.workplace.agentruntime.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * AI 실행 위치·템플릿·실행 설정(WP-1246~1248) 예외의 공통 부모 — 응답 상태와 {@code errors.code} 를 예외가 정한다.
 * GlobalExceptionHandler 의 {@link CodedException} 공용 처리기가 이 한 타입으로 모든 하위 예외를 응답으로 옮긴다(예외마다 처리기를 늘리지
 * 않게). 메시지는 화면에 그대로 보인다.
 */
public abstract class AgentRuntimeException extends RuntimeException implements CodedException {

  private final HttpStatus status;
  private final Map<String, String> errors;

  protected AgentRuntimeException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.errors = Map.of("code", code);
  }

  @Override
  public HttpStatus status() {
    return status;
  }

  @Override
  public Map<String, String> errors() {
    return errors;
  }
}
