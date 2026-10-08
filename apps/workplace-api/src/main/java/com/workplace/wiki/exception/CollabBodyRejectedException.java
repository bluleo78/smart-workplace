package com.workplace.wiki.exception;

/**
 * 동기화 서버가 제출 본문을 거부했다(400 — 빈 AI 본문·해석할 수 없는 본문 등, WP-289). 호출자가 보낸 본문의 문제라 그대로 400 으로 돌려 사유를 보여
 * 준다(재시도해도 같은 결과).
 */
public class CollabBodyRejectedException extends RuntimeException {
  public CollabBodyRejectedException(String message, Throwable cause) {
    super(message, cause);
  }
}
