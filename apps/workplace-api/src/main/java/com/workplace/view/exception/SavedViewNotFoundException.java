package com.workplace.view.exception;

/** 저장된 뷰 없음 — 404 매핑. */
public class SavedViewNotFoundException extends RuntimeException {
  public SavedViewNotFoundException(Long id) {
    super("저장된 뷰를 찾을 수 없습니다: id=" + id);
  }
}
