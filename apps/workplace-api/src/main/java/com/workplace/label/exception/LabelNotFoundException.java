package com.workplace.label.exception;

/** 라벨이 존재하지 않음 — 404 매핑. */
public class LabelNotFoundException extends RuntimeException {
  public LabelNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("라벨을 찾을 수 없습니다");
  }
}
