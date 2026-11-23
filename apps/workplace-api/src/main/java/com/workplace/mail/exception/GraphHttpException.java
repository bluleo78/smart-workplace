package com.workplace.mail.exception;

/**
 * Graph API 가 2xx 가 아닌 HTTP 상태로 응답했을 때의 동기화 오류(WP-2030). {@link MailSyncException} 의 하위라 기존 처리는
 * 그대로이고, 호출부가 상태 코드(예: delta 의 $expand 거부 400)를 보고 한 번 다시 시도할 수 있게 상태를 싣는다.
 */
public class GraphHttpException extends MailSyncException {

  private final int status;

  public GraphHttpException(int status) {
    super("Graph API 호출 실패: " + status);
    this.status = status;
  }

  /** Graph 가 돌려준 HTTP 상태 코드. */
  public int status() {
    return status;
  }
}
