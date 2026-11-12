package com.workplace.mail.exception;

/**
 * 없거나 남의 서명 이미지(WP-1517) — 존재를 드러내지 않게 둘 다 404. 웹이 다른 404 와 가릴 수 있게 {@code errors.code} 에 {@link
 * #CODE} 를 싣는다.
 */
public class MailSignatureImageNotFoundException extends RuntimeException {

  /** errors.code 로 싣는 사유 코드. */
  public static final String CODE = "SIGNATURE_IMAGE_NOT_FOUND";

  public MailSignatureImageNotFoundException() {
    super("서명 이미지를 찾을 수 없어요");
  }
}
