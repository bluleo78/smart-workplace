package com.workplace.home.exception;

/** 메인 AI 채팅 누적 요약 생성 실패(WP-232). 호출부가 잡아 폴백하므로 사용자 응답으로 매핑하지 않는다. */
public class HomeContextSummaryException extends RuntimeException {
  public HomeContextSummaryException(String message, Throwable cause) {
    super(message, cause);
  }
}
