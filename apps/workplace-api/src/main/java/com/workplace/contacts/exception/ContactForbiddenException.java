package com.workplace.contacts.exception;

/** SHARED 연락처에 대한 비-owner 쓰기 시도 등 접근 금지(403). PERSONAL 타인은 404(존재 은닉)를 쓴다. */
public class ContactForbiddenException extends RuntimeException {
  public ContactForbiddenException(long id, long userId) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("이 연락처를 수정할 권한이 없습니다");
  }
}
