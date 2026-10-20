package com.workplace.drive.exception;

/**
 * 공간 멤버지만 요구 역할 미달, 또는 링크 조작 권한 없음. 문구는 화면 토스트에 그대로 뜨므로 공간·사용자 id 를 싣지 않는다(WP-602) — 인자는 호출부 호환을 위해
 * 받기만 한다.
 */
public class DriveForbiddenException extends RuntimeException {
  public DriveForbiddenException(long spaceId, long userId) {
    super("이 드라이브 공간에서 이 작업을 할 권한이 없습니다");
  }

  /** 링크 조작 등 공간 외 금지 상황에서 메시지로 직접 생성. */
  public DriveForbiddenException(String message) {
    super(message);
  }
}
