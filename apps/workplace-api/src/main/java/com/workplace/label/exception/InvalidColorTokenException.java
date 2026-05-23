package com.workplace.label.exception;

/** 화이트리스트에 없는 라벨 색상 토큰 — 400 매핑. */
public class InvalidColorTokenException extends RuntimeException {
  public InvalidColorTokenException(String token) {
    super("허용되지 않은 색상 토큰: " + token);
  }
}
