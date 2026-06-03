package com.workplace.mail.exception;

import com.workplace.mail.dto.ConnectionTestResult;

/**
 * 저장 전 IMAP/SMTP 연결 테스트가 실패했을 때 발생. 어느 프로토콜이 왜 실패했는지 {@link ConnectionTestResult} 로 전달한다. HTTP 매핑은
 * {@code MailExceptionHandler}(Task 6) 가 400 + result 바디로 처리한다.
 */
public class MailConnectionException extends RuntimeException {
  private final transient ConnectionTestResult result;

  public MailConnectionException(ConnectionTestResult result) {
    super("메일 서버 연결 테스트에 실패했습니다");
    this.result = result;
  }

  public ConnectionTestResult result() {
    return result;
  }
}
