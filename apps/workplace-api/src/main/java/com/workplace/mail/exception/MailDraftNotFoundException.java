package com.workplace.mail.exception;

/**
 * 없거나 남의 임시저장(WP-577) — 존재를 드러내지 않게 둘 다 404. 웹이 계정 404 등 다른 404 와 가려 「다른 곳에서 보냈거나 버린 메일」로 다루도록
 * {@code errors.code} 에 {@link #CODE} 를 싣는다.
 */
public class MailDraftNotFoundException extends RuntimeException {

  /** errors.code 로 싣는 사유 코드. */
  public static final String CODE = "DRAFT_NOT_FOUND";

  public MailDraftNotFoundException(long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나간다(WP-619 와 같은 규칙)
    super("임시저장을 찾을 수 없어요");
  }
}
