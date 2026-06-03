package com.workplace.mail.controller;

import com.workplace.mail.dto.ConnectionTestResult;
import com.workplace.mail.exception.MailConnectionException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 메일 도메인 전용 예외 매핑. 연결 테스트 실패는 어느 프로토콜이 왜 실패했는지 클라이언트가 알아야 하므로 400 + ConnectionTestResult 바디로
 * 응답한다(나머지 예외는 각 예외 클래스의 @ResponseStatus 로 처리). GlobalExceptionHandler 보다 먼저 처리되도록
 * HIGHEST_PRECEDENCE 를 부여한다.
 */
@Order(Ordered.HIGHEST_PRECEDENCE)
@RestControllerAdvice(basePackages = "com.workplace.mail")
public class MailExceptionHandler {

  @ExceptionHandler(MailConnectionException.class)
  public ResponseEntity<ConnectionTestResult> handleConnection(MailConnectionException e) {
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(e.result());
  }
}
