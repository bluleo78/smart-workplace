package com.workplace.issue.exception;

/** 프로젝트 custom field 정의를 찾을 수 없을 때. → 404. */
public class FieldNotFoundException extends RuntimeException {
  public FieldNotFoundException(Long id) {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("필드를 찾을 수 없습니다");
  }
}
