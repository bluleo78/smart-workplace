package com.workplace.user.exception;

/**
 * 비밀번호 변경의 현재 비밀번호 불일치(400). WP-626: 실패 감사 로그를 남긴 트랜잭션이 이 예외로 롤백되지 않게 따로 구분한다(changePassword 의
 * noRollbackFor) — 불일치 경로는 감사 기록 말고는 쓰는 것이 없다.
 */
public class CurrentPasswordMismatchException extends IllegalArgumentException {
  public CurrentPasswordMismatchException() {
    super("현재 비밀번호가 올바르지 않습니다");
  }
}
