package com.workplace.mail.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * SMTP 발송 실패 — 상위(메일 서버) 오류이므로 502. 인증/네트워크/수신거부를 포괄한다.
 *
 * <p>사용자용 여부(WP-1786): 대부분의 발송 실패 문구는 공급자 응답 코드·내부 단계 이름을 싣고 있어 보낼 대기열의 실패 사유(send_error, 화면의 「보내지
 * 못한 이유」)에 그대로 남기지 않는다. 사용자가 읽고 고칠 수 있게 쓴 문구는 던지는 곳에서 {@link #userFacing} 으로 만들어 표시한다 — 문구 문자열을 따로
 * 목록으로 맞춰 보지 않아도 되게.
 */
@ResponseStatus(HttpStatus.BAD_GATEWAY)
public class MailSendException extends RuntimeException {

  /** 문구를 사용자에게 그대로 보여도 되는가. */
  private final boolean userFacing;

  public MailSendException(String message) {
    this(message, null, false);
  }

  public MailSendException(String message, Throwable cause) {
    this(message, cause, false);
  }

  private MailSendException(String message, Throwable cause, boolean userFacing) {
    super(message, cause);
    this.userFacing = userFacing;
  }

  /** 사용자에게 그대로 보여도 되는 문구의 발송 실패. */
  public static MailSendException userFacing(String message) {
    return new MailSendException(message, null, true);
  }

  /** 사용자에게 그대로 보여도 되는 문구의 발송 실패(원인 포함 — 원인은 로그에만 남는다). */
  public static MailSendException userFacing(String message, Throwable cause) {
    return new MailSendException(message, cause, true);
  }

  /** 문구가 사용자용인가 — 보낼 대기열이 실패 사유로 그대로 남길지 판단한다. */
  public boolean isUserFacing() {
    return userFacing;
  }
}
