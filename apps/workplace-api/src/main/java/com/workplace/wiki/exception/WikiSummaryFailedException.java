package com.workplace.wiki.exception;

/** 노트 AI 요약(ai-agent /wiki/summarize) 호출 실패·빈 요약 → 502(GlobalExceptionHandler). */
public class WikiSummaryFailedException extends RuntimeException {
  public WikiSummaryFailedException(String message, Throwable cause) {
    super(message, cause);
  }
}
