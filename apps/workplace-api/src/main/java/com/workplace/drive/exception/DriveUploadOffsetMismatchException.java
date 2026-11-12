package com.workplace.drive.exception;

import org.springframework.http.HttpStatus;

/**
 * 조각의 offset 이 서버가 받은 바이트와 다름(WP-1520) → 409. 공통 오류 응답의 errors 에 code({@value #CODE})와 지금 받은
 * 바이트(receivedBytes, 문자열 숫자)를 실어 화면이 그 위치부터 이어 보내게 한다 — 앞 조각의 응답을 놓쳐 같은 조각을 다시 보냈거나, 다른 탭이 먼저 이어 올린
 * 경우다. 응답은 {@link DriveUploadSessionException} 의 공용 처리기가 만든다.
 */
public class DriveUploadOffsetMismatchException extends DriveUploadSessionException {
  /** errors.code 값. */
  public static final String CODE = "UPLOAD_OFFSET_MISMATCH";

  public DriveUploadOffsetMismatchException(long receivedBytes) {
    super(HttpStatus.CONFLICT, CODE, "업로드 위치가 맞지 않습니다. 받은 위치부터 이어서 올려 주세요", receivedBytes);
  }
}
