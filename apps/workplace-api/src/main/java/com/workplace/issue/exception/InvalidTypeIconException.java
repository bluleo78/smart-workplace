package com.workplace.issue.exception;

/** 화이트리스트에 없는 아이콘 이름을 입력한 경우 — 400. */
public class InvalidTypeIconException extends RuntimeException {
  public InvalidTypeIconException(String icon) {
    super("허용되지 않은 아이콘: " + icon);
  }
}
