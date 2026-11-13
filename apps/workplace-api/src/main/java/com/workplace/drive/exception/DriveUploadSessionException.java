package com.workplace.drive.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 나눠 올리기(WP-1520) 요청 거절 — 상태(400·409·413)와 사유 코드(errors.code)를 예외가 정한다. 화면은 코드로 재시도 여부를 고른다(4xx 는
 * 같은 조각을 다시 보내도 같은 결과라 재시도하지 않는다).
 */
public class DriveUploadSessionException extends RuntimeException implements CodedException {
  /** 받은 바이트가 전체 크기에 못 미쳤는데 완료를 요청함(409). */
  public static final String CODE_INCOMPLETE = "UPLOAD_INCOMPLETE";

  /** 조각이 허용 길이를 넘음(413). */
  public static final String CODE_CHUNK_TOO_LARGE = "UPLOAD_CHUNK_TOO_LARGE";

  /** 조각이 비었거나 전체 크기를 넘어섬(400). */
  public static final String CODE_INVALID_CHUNK = "UPLOAD_INVALID_CHUNK";

  private final HttpStatus status;
  private final Map<String, String> errors;

  public DriveUploadSessionException(HttpStatus status, String code, String message) {
    super(message);
    this.status = status;
    this.errors = Map.of("code", code);
  }

  /**
   * 서버가 지금까지 받은 바이트를 errors.receivedBytes(문자열 숫자)로 함께 싣는다 — 위치 불일치·미완료 409 에서 화면이 상태를 다시 묻지 않고 그
   * 위치부터 이어 보내게 한다.
   */
  public DriveUploadSessionException(
      HttpStatus status, String code, String message, long receivedBytes) {
    super(message);
    this.status = status;
    this.errors = Map.of("code", code, "receivedBytes", String.valueOf(receivedBytes));
  }

  @Override
  public HttpStatus status() {
    return status;
  }

  @Override
  public Map<String, String> errors() {
    return errors;
  }
}
