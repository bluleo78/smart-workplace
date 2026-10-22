package com.workplace.global.exception;

import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 예외가 응답 상태와 {@code errors}(사유 코드 등)를 직접 정하는 도메인 예외의 공통 계약. 이를 구현한 예외는 {@link
 * GlobalExceptionHandler} 의 한 처리기가 그대로 응답으로 옮긴다 — 예외마다 같은 모양의 처리기를 늘리지 않으려는 것.
 */
public interface CodedException {

  /** 응답에 쓸 HTTP 상태. */
  HttpStatus status();

  /** 응답 errors — 사유 코드 등. */
  Map<String, String> errors();
}
