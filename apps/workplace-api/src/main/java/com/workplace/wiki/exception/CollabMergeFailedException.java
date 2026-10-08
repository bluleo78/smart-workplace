package com.workplace.wiki.exception;

/**
 * 동기화 서버의 병합 계산이 실패했다(500 — 병합 워커 오류, WP-289). 아무것도 적용되지 않았다. 일시 장애(503)와 달리 같은 입력으로 재시도해도 실패할 수 있어
 * 502 로 구분한다(GlobalExceptionHandler).
 */
public class CollabMergeFailedException extends RuntimeException {
  public CollabMergeFailedException(String message, Throwable cause) {
    super(message, cause);
  }
}
