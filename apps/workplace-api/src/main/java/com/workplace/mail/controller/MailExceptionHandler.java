package com.workplace.mail.controller;

import com.workplace.global.dto.ErrorResponse;
import com.workplace.mail.dto.ConnectionTestResult;
import com.workplace.mail.exception.MailAiException;
import com.workplace.mail.exception.MailAiUnavailableException;
import com.workplace.mail.exception.MailConnectionException;
import com.workplace.mail.exception.MailDraftConflictException;
import com.workplace.mail.exception.MailDraftNotFoundException;
import com.workplace.mail.exception.MailValidationException;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.Map;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 메일 도메인 전용 예외 매핑. 연결 테스트 실패는 어느 프로토콜이 왜 실패했는지 클라이언트가 알아야 하므로 400 + ConnectionTestResult 바디로
 * 응답한다(의도된 특수 형태). MailValidationException 은 입력 검증 실패로 400 + 표준 ErrorResponse 바디(message 포함)로 명시
 * 처리한다 — 프론트가 message 로 토스트를 띄우므로 GlobalExceptionHandler 와 동일한 형태를 유지한다. 나머지 예외는 각 예외
 * 클래스의 @ResponseStatus 로 처리. GlobalExceptionHandler 보다 먼저 처리되도록 HIGHEST_PRECEDENCE 를 부여한다.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(basePackages = "com.workplace.mail")
public class MailExceptionHandler {

  @ExceptionHandler(MailConnectionException.class)
  public ResponseEntity<ConnectionTestResult> handleConnection(MailConnectionException e) {
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.result());
  }

  /** 발송/계정 등록 입력 검증 실패 → 400 + 표준 ErrorResponse(message 포함). */
  @ExceptionHandler(MailValidationException.class)
  public ResponseEntity<ErrorResponse> handleValidation(
      MailValidationException e, HttpServletRequest request) {
    return error(HttpStatus.BAD_REQUEST, e.getMessage(), null, request);
  }

  /**
   * AI 비서 서비스 미설정·일시 불가 → 503 + ErrorResponse(message 포함). 영구
   * 사유(AI_DISABLED·ASSISTANT_NOT_CONFIGURED)면 {@code errors.code} 를 싣고, 일시 불가(ai-agent 재기동 등)는
   * errors 가 null 이다.
   */
  @ExceptionHandler(MailAiUnavailableException.class)
  public ResponseEntity<ErrorResponse> handleAiUnavailable(
      MailAiUnavailableException e, HttpServletRequest request) {
    return error(
        HttpStatus.SERVICE_UNAVAILABLE,
        e.getMessage(),
        e.code() == null ? null : Map.of("code", e.code()),
        request);
  }

  /** AI 비서 호출 실패(IO/4xx/5xx) → 502 + ErrorResponse(message 포함). */
  @ExceptionHandler(MailAiException.class)
  public ResponseEntity<ErrorResponse> handleAi(MailAiException e, HttpServletRequest request) {
    return error(HttpStatus.BAD_GATEWAY, e.getMessage(), null, request);
  }

  /**
   * 없거나 남의 임시저장(WP-577) → 404 + errors.code=DRAFT_NOT_FOUND — 웹이 계정 404 같은 다른 404 와 가려 「다른 곳에서 보냈거나
   * 버린 메일」로 다룬다.
   */
  @ExceptionHandler(MailDraftNotFoundException.class)
  public ResponseEntity<ErrorResponse> handleDraftNotFound(
      MailDraftNotFoundException e, HttpServletRequest request) {
    return error(
        HttpStatus.NOT_FOUND,
        e.getMessage(),
        Map.of("code", MailDraftNotFoundException.CODE),
        request);
  }

  /** 임시저장 버전 충돌(WP-577) → 409 + errors.code=DRAFT_CONFLICT — 웹이 코드로 가려 최신본을 다시 불러온다. */
  @ExceptionHandler(MailDraftConflictException.class)
  public ResponseEntity<ErrorResponse> handleDraftConflict(
      MailDraftConflictException e, HttpServletRequest request) {
    return error(
        HttpStatus.CONFLICT,
        e.getMessage(),
        Map.of("code", MailDraftConflictException.CODE),
        request);
  }

  /** 표준 ErrorResponse 응답. */
  private static ResponseEntity<ErrorResponse> error(
      HttpStatus status, String message, Map<String, String> errors, HttpServletRequest request) {
    ErrorResponse body =
        new ErrorResponse(
            status.value(),
            status.getReasonPhrase(),
            message,
            errors,
            Instant.now().toString(),
            request.getRequestURI());
    return ResponseEntity.status(status).body(body);
  }
}
