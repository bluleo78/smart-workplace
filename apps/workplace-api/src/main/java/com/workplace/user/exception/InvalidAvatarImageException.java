package com.workplace.user.exception;

/**
 * 아바타로 쓸 수 없는 이미지(WP-1222) — 형식·크기·자를 영역이 맞지 않을 때. {@link IllegalArgumentException} 을 이어받아 공용 처리기가
 * 400 과 이 문구로 응답한다(문구는 웹이 그대로 토스트로 보여 주므로 사용자 말로 쓴다).
 */
public class InvalidAvatarImageException extends IllegalArgumentException {
  public InvalidAvatarImageException(String message) {
    super(message);
  }
}
