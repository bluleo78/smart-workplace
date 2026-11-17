package com.workplace.messaging.exception;

/**
 * 메시지 수정의 keepFileIds 에 그 메시지에 지금 붙어 있지 않은 파일 id 가 있다(WP-1679). → 400
 *
 * <p>다른 메시지의 첨부를 끌어오거나, 다른 기기에서 이미 뺀 첨부를 옛 화면 상태로 조용히 되살리지 않게 거절한다.
 */
public class InvalidKeepFileIdsException extends RuntimeException {
  public InvalidKeepFileIdsException() {
    super("이 메시지에 붙은 첨부가 아닙니다");
  }
}
