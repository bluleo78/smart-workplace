package com.workplace.drive.exception;

/**
 * 전송 링크(WP-369)의 토큰이 없거나 잘못됐거나(다른 종류 토큰 포함), 테넌트가 비활성이거나, 링크를 쓴 뒤 대상 파일이 사라짐. → 404
 *
 * <p>공개 경로라 메시지에 식별자(id)를 넣지 않고, 링크 소지자가 할 일("새 링크를 발급받으세요")을 안내한다.
 */
public class DriveTransferLinkNotFoundException extends RuntimeException {
  public DriveTransferLinkNotFoundException() {
    super("전송 링크를 찾을 수 없습니다. 새 링크를 발급받으세요");
  }

  /** 링크는 맞았지만 대상(파일 등)이 사라진 경우처럼 사유를 달리 적을 때. */
  public DriveTransferLinkNotFoundException(String message) {
    super(message);
  }
}
