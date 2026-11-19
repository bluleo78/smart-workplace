package com.workplace.mail.exception;

/**
 * 보내는 중인 임시보관을 고치거나 지우려 했다(WP-1786, 409) — 대기(QUEUED)·발송 중(SENDING) 행은 스케줄러가 곧 보내므로 자동 저장·삭제가 끼어들면
 * 안 된다. 웹이 {@code errors.code} 로 가려 「보내는 중」으로 안내한다.
 */
public class MailDraftSendingException extends RuntimeException {

  /** errors.code 로 싣는 사유 코드. */
  public static final String CODE = "DRAFT_SENDING";

  public MailDraftSendingException() {
    super("보내는 중인 메일이라 고치거나 지울 수 없어요");
  }
}
