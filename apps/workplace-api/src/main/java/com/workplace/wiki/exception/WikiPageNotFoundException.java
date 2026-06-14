package com.workplace.wiki.exception;

public class WikiPageNotFoundException extends RuntimeException {
  public WikiPageNotFoundException(long pageId) {
    super("위키 페이지를 찾을 수 없습니다: " + pageId);
  }
}
