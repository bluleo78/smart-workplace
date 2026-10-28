package com.workplace.mail.exception;

/**
 * 응답할 수 없는 초대(WP-986) — 취소 메일, 이후 변경된 옛 초대, 주최자·참석자 정보가 없음, M365 에서 이어진 일정을 찾지 못함. 409 +
 * errors.code=INVITE_NOT_RESPONDABLE({@code MailExceptionHandler}).
 */
public class MailInviteNotRespondableException extends RuntimeException {

  /** errors.code 로 싣는 사유 코드. */
  public static final String CODE = "INVITE_NOT_RESPONDABLE";

  public MailInviteNotRespondableException(String message) {
    super(message);
  }
}
