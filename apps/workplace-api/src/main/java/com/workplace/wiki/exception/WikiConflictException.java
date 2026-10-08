package com.workplace.wiki.exception;

public class WikiConflictException extends RuntimeException {
  public WikiConflictException(long pageId) {
    super("다른 사용자가 먼저 수정했습니다: page=" + pageId);
  }

  /** 다른 사유의 409(기준본 만료 등) — 하위 예외가 문구를 정한다. */
  protected WikiConflictException(String message) {
    super(message);
  }
}
