package com.workplace.home.service;

import java.io.InterruptedIOException;

/**
 * 홈 채팅 취소(Future.cancel(true)) 판별 헬퍼. HomeChatService(펌프 바깥 catch)와 HomeContextSummaryService(동기 요약
 * 실패 처리)가 같은 기준으로 "사용자 취소" 를 판별하도록 한 곳에 둔다(WP-232).
 */
final class HomeInterruptions {

  private HomeInterruptions() {}

  /**
   * 예외 체인(cause chain)을 순회해 InterruptedException/InterruptedIOException 이 있는지 검사한다
   * (WikiAiService.isInterruption 과 동일 — 취소로 인한 인터럽트가 블로킹 read 를 통과할 때 여러 겹으로 감싸질 수 있어 최상위 타입만 보면
   * 놓친다).
   */
  static boolean isInterruption(Throwable e) {
    for (Throwable cur = e; cur != null; cur = cur.getCause()) {
      if (cur instanceof InterruptedException || cur instanceof InterruptedIOException) {
        return true;
      }
    }
    return false;
  }
}
