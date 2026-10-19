package com.workplace.global.security;

/**
 * 비밀번호가 bcrypt 한도(72바이트)를 넘을 때(WP-497). IllegalArgumentException 이라 전역 처리기가 이 한국어 메시지로 400 을 돌려준다 —
 * 예전엔 bcrypt 영어 원문 「password cannot be more than 72 bytes」가 그대로 토스트에 나왔다.
 */
public class PasswordTooLongException extends IllegalArgumentException {
  public PasswordTooLongException() {
    super("비밀번호는 72바이트를 넘을 수 없습니다(영문 72자, 한글 24자까지)");
  }
}
