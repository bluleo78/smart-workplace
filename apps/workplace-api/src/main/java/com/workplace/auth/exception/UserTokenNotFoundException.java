package com.workplace.auth.exception;

/** 지정한 PAT id 가 존재하지 않거나 대상 user 와 불일치 — 404. */
public class UserTokenNotFoundException extends RuntimeException {
  public UserTokenNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("API 토큰을 찾을 수 없습니다");
  }
}
