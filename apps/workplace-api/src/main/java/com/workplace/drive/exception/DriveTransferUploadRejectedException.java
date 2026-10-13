package com.workplace.drive.exception;

import org.springframework.http.HttpStatus;

/**
 * 업로드 링크(WP-369) PUT 을 받지 못함 — 본문 형식(415), 크기 초과·본문 중단(400), 할당량 초과(409). 상태는 발생 지점이 정한다.
 *
 * <p>링크를 소비한 뒤의 실패는 다시 쓸 수 없으므로 문구가 "새 링크를 발급받으세요"로 끝난다. 익명 링크 소지자에게 내부 id 를 드러내지 않게 일반 예외 대신 이 예외로
 * 바꿔 던진다.
 */
public class DriveTransferUploadRejectedException extends RuntimeException {
  private final HttpStatus status;

  public DriveTransferUploadRejectedException(HttpStatus status, String message) {
    super(message);
    this.status = status;
  }

  public HttpStatus status() {
    return status;
  }
}
