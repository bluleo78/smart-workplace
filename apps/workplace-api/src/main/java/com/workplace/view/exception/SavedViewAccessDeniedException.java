package com.workplace.view.exception;

/** 본인 소유가 아닌 뷰 수정/삭제 시도 — 403 매핑. */
public class SavedViewAccessDeniedException extends RuntimeException {
  public SavedViewAccessDeniedException(String message) {
    super(message);
  }
}
