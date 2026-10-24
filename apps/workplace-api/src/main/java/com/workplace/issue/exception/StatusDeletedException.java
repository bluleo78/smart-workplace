package com.workplace.issue.exception;

import com.workplace.global.exception.CodedException;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * 이슈에 쓰려던 상태가 방금 삭제됨 — 409 와 사유 코드 STATUS_DELETED (WP-936). 상태 삭제와 그 상태로 이슈를 만들거나 옮기는 요청이 겹치면, 서비스의
 * 상태 확인을 지난 뒤 삭제가 커밋돼 쓰기가 복합 FK(fk_issue_status_category) 위반으로 실패한다. 공용 처리기는 이를 「참조한 항목을 찾을 수 없습니다」
 * 404 로 내보내 무엇을 해야 할지 알 수 없었다 — 다른 상태를 고르면 되는 상황이라 충돌로 알리고 할 일을 함께 말한다. 삭제가 먼저 끝나 확인 단계에서 상태가 없으면 이
 * 경합이 아니라 400 STATUS_NOT_FOUND({@link RequestedStatusNotFoundException}) 다. 같은 409 인 버전 충돌(#611)과
 * 웹이 가를 수 있게(상태 목록 다시 받기) 코드를 싣는다.
 */
public class StatusDeletedException extends RuntimeException implements CodedException {

  /** 응답 errors.code — 웹이 상태 목록을 다시 받는 기준. */
  public static final String CODE = "STATUS_DELETED";

  private static final String MESSAGE = "상태가 방금 삭제됐어요. 다른 상태를 골라 주세요.";

  public StatusDeletedException(Throwable cause) {
    super(MESSAGE, cause);
  }

  /** 응답 상태 — 항상 409. */
  @Override
  public HttpStatus status() {
    return HttpStatus.CONFLICT;
  }

  /** 응답 {@code errors} — 사유 코드 하나. */
  @Override
  public Map<String, String> errors() {
    return Map.of("code", CODE);
  }
}
