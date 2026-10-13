package com.workplace.drive.exception;

/**
 * 전송 링크(WP-369)를 쓸 때 다시 확인한 발급자 권한이 없어짐(공간·워크스페이스에서 빠졌거나 역할이 내려감). → 403
 *
 * <p>{@link DriveForbiddenException} 의 (spaceId, userId) 메시지는 익명 링크 소지자에게 내부 id 를 드러내므로 따로 둔다.
 */
public class DriveTransferLinkForbiddenException extends RuntimeException {
  public DriveTransferLinkForbiddenException(String message) {
    super(message);
  }
}
