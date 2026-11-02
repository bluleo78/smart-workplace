package com.workplace.wiki.exception;

/**
 * 페이지 종류에 맞지 않는 저장·편집 시도(WP-1307) — HTML 문서에 마크다운 본문 저장·동기화 서버 연결, 노트에 원본 HTML 저장 등. 종류는 만든 뒤 바뀌지
 * 않는다. HTTP 409.
 */
public class WikiPageKindMismatchException extends RuntimeException {
  public WikiPageKindMismatchException(String message) {
    super(message);
  }
}
