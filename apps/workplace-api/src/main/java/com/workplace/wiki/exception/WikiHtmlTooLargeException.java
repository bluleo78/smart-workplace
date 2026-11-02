package com.workplace.wiki.exception;

/** HTML 문서 원본이 크기 상한(5MB, UTF-8 바이트)을 넘었다(WP-1307). HTTP 413. */
public class WikiHtmlTooLargeException extends RuntimeException {
  public WikiHtmlTooLargeException() {
    super("HTML 문서는 5MB 까지 올릴 수 있습니다");
  }
}
