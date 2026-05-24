package com.workplace.auth.exception;

/** 지정한 키 id 가 존재하지 않거나 대상 user 와 불일치 — 404. */
public class KeyNotFoundException extends RuntimeException {
  public KeyNotFoundException(Long id) {
    super("키를 찾을 수 없습니다: id=" + id);
  }
}
