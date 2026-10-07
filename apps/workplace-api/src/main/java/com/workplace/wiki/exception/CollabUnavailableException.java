package com.workplace.wiki.exception;

/**
 * 노트 동기화 서버(workplace-collab) 호출 실패 — 연결 거부·타임아웃·오류 응답(WP-285).
 *
 * <p>본문 저장은 동기화 서버가 원본이라 직접 DB 에 쓰는 우회가 없다. 그래서 실패를 조용히 삼키지 않고 503 으로 돌려 호출자(구버전 웹·MCP)가 재시도하게
 * 한다(GlobalExceptionHandler).
 */
public class CollabUnavailableException extends RuntimeException {
  public CollabUnavailableException(String message, Throwable cause) {
    super(message, cause);
  }
}
