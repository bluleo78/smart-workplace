package com.workplace.mail.exception;

/**
 * 임시저장 버전 충돌(WP-577, 409) — 다른 탭·기기가 먼저 저장해 요청의 version 이 지금 값과 다르다. 웹이 {@code errors.code} 로 가려
 * 최신본을 다시 불러올지 묻는다.
 */
public class MailDraftConflictException extends RuntimeException {

  /** errors.code 로 싣는 사유 코드. */
  public static final String CODE = "DRAFT_CONFLICT";

  public MailDraftConflictException() {
    super("다른 창에서 이 임시저장을 먼저 고쳤어요. 최신 내용을 다시 불러와 주세요");
  }
}
