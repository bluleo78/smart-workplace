package com.workplace.auth.exception;

/**
 * 공개 셀프 회원가입이 닫힌 상태에서 가입을 시도한 경우 — 403.
 *
 * <p>부트스트랩(첫 사용자) 이후에는 웹 공개 가입을 막는다. 신규 사용자는 운영자 콘솔에서 테넌트 멤버로 추가하며 계정이 생성된다(#495/#497).
 */
public class SignupDisabledException extends RuntimeException {
  public SignupDisabledException(String message) {
    super(message);
  }
}
