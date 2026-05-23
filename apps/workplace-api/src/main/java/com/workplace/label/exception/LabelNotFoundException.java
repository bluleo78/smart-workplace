package com.workplace.label.exception;

/** 라벨이 존재하지 않음 — 404 매핑. */
public class LabelNotFoundException extends RuntimeException {
  public LabelNotFoundException(Long id) {
    super("라벨을 찾을 수 없습니다: id=" + id);
  }
}
