package com.workplace.cycle.exception;

/** 사이클이 존재하지 않음 — 404 매핑. */
public class CycleNotFoundException extends RuntimeException {
  public CycleNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("사이클을 찾을 수 없습니다");
  }
}
