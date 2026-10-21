package com.workplace.wiki.exception;

/**
 * 공유가 없는 페이지의 링크를 다시 만들려 할 때(404, WP-579). 편집 권한 판정을 통과한 사람에게만 닿는 경로라 페이지 404 와 구분되는 문구를 그대로 보인다.
 */
public class WikiShareNotFoundException extends RuntimeException {
  public WikiShareNotFoundException() {
    super("이 페이지에는 공유 링크가 없습니다");
  }

  /** 링크 열기·접근 요청처럼 받는 사람 쪽의 404 — 없음·해제·만료·재발급을 구분하지 않는 문구를 넘긴다. */
  public WikiShareNotFoundException(String message) {
    super(message);
  }
}
