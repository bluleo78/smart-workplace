package com.workplace.view.exception;

/** 저장된 뷰 없음 — 404 매핑. */
public class SavedViewNotFoundException extends RuntimeException {
  public SavedViewNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("저장된 뷰를 찾을 수 없습니다");
  }
}
