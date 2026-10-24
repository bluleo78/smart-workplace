package com.workplace.issue.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 이슈에 쓰려던 statusId 의 상태가 없음 — 400 과 사유 코드 STATUS_NOT_FOUND (WP-936). 요청 전에 상태가 삭제됐는데 웹이 예전 상태 목록으로
 * 보낸 경우다. 「방금 삭제됨」 409(STATUS_DELETED)는 확인 뒤 삭제가 커밋되는 경합에만 쓴다 — 아무 id 나 보낸 API 호출자에게 「방금 삭제됐다」고 말하지
 * 않도록 400 을 지킨다. 다른 프로젝트의 상태는 여기가 아니라 예전처럼 「이 프로젝트의 상태가 아닙니다」({@link
 * InvalidStatusForProjectException}) 다. 웹이 코드를 보고 상태 목록을 다시 받는다.
 */
public class RequestedStatusNotFoundException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 상태 목록을 다시 받는 기준. */
  public static final String CODE = "STATUS_NOT_FOUND";

  private static final String MESSAGE = "상태를 찾을 수 없어요. 다른 상태를 골라 주세요.";

  public RequestedStatusNotFoundException() {
    super(MESSAGE);
  }

  /** 응답 상태 — 항상 400. */
  @Override
  public HttpStatus status() {
    return HttpStatus.BAD_REQUEST;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
