package com.workplace.wiki.exception;

public class WikiConflictException extends RuntimeException {
  public WikiConflictException(long pageId) {
    super("다른 사용자가 먼저 수정했습니다: page=" + pageId);
  }
}
