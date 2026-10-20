package com.workplace.issue.exception;

/** 이슈 유형 정의를 찾을 수 없는 경우 — 404. */
public class TypeNotFoundException extends RuntimeException {
  public TypeNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("유형을 찾을 수 없습니다");
  }
}
