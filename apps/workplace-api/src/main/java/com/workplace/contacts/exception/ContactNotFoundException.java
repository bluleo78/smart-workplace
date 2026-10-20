package com.workplace.contacts.exception;

/** 연락처 미존재 또는 접근 격리(PERSONAL 타인) 시. 존재 은닉을 위해 격리 위반도 404 로 매핑한다. */
public class ContactNotFoundException extends RuntimeException {
  public ContactNotFoundException(String type, long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("연락처를 찾을 수 없습니다");
  }
}
