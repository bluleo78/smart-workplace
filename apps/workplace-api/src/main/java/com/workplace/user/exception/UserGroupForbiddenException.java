package com.workplace.user.exception;

/** SHARED 그룹을 user-group:manage 권한 없이 변경 시도 시 → 403. */
public class UserGroupForbiddenException extends RuntimeException {
  public UserGroupForbiddenException(long id, long userId) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("이 그룹을 관리할 권한이 없습니다");
  }
}
