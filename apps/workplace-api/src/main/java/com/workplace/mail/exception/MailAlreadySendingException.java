package com.workplace.mail.exception;

/**
 * 되돌리려 했지만 이미 보내는 중(SENDING)인 메일(WP-1786) — 늦은 되돌리기. 409 + errors.code={@link #CODE}, 웹이 「이미 보냈어요」로
 * 안내한다.
 */
public class MailAlreadySendingException extends RuntimeException {

  /** errors.code 로 싣는 사유 코드. */
  public static final String CODE = "ALREADY_SENDING";

  public MailAlreadySendingException() {
    super("이미 보내는 중이라 되돌릴 수 없어요");
  }
}
