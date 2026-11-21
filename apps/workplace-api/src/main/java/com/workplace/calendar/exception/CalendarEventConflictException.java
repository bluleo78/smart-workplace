package com.workplace.calendar.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 일정 수정 충돌(WP-1920, 409) — 화면이 일정을 연 뒤 다른 사람(또는 다른 탭)이 먼저 고쳐 요청의 expectedUpdatedAt 이 지금 값과 다르다. 그대로
 * 저장하면 앞사람의 수정이 조용히 사라지므로 막는다. 웹은 {@code errors.code} 로 가려 최신 내용을 다시 불러온다.
 */
public class CalendarEventConflictException extends RuntimeException implements CodedException {

  /** errors.code 로 싣는 사유 코드. */
  public static final String CODE = "EVENT_CONFLICT";

  public CalendarEventConflictException() {
    super("다른 사람이 먼저 이 일정을 수정했습니다. 최신 내용을 확인한 뒤 다시 저장해 주세요.");
  }

  @Override
  public HttpStatus status() {
    return HttpStatus.CONFLICT;
  }

  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
