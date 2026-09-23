package com.workplace.user.exception;

/** 사용자를 찾을 수 없을 때(404). 메시지는 응답·확인카드 실패 사유로 그대로 노출되므로 한국어로 둔다. */
public class UserNotFoundException extends RuntimeException {
  public UserNotFoundException(String message) {
    super(message);
  }

  /** id 로 찾지 못한 경우의 표준 문구 — 호출 지점마다 문구를 복붙하지 않도록 모은다(#849). */
  public static UserNotFoundException ofId(Long id) {
    return new UserNotFoundException("사용자를 찾을 수 없습니다 (id: " + id + ")");
  }
}
