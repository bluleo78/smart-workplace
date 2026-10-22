package com.workplace.auth.exception;

/**
 * 이미 쓰인 refresh 토큰을 grace 밖에서 다시 쓴 경우(탈취 의심, 401). WP-819: 갱신 트랜잭션은 이 예외를 던지기 전에 family 전체를 폐기하므로,
 * 그 폐기가 롤백되지 않게 따로 구분한다(refresh 의 noRollbackFor) — 이 경로는 폐기 말고는 쓰는 것이 없다.
 */
public class RefreshTokenReuseException extends InvalidTokenException {
  public RefreshTokenReuseException() {
    super("이미 사용된 토큰입니다. 다시 로그인해 주세요.");
  }
}
