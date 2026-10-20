package com.workplace.user.exception;

/** 그룹 미존재 또는 PERSONAL 격리 위반(타인 소유) 시. 존재 은닉을 위해 격리 위반도 404 로 매핑한다. */
public class UserGroupNotFoundException extends RuntimeException {
  public UserGroupNotFoundException(long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("그룹을 찾을 수 없습니다");
  }
}
