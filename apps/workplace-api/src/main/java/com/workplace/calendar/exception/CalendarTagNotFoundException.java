package com.workplace.calendar.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 태그 미존재 또는 남의 태그(WP-714) — 존재 은닉을 위해 남의 태그도 404 로 응답한다(일정 404 와 같은 규칙). */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class CalendarTagNotFoundException extends RuntimeException {
  public CalendarTagNotFoundException() {
    // 문구에 id 를 넣지 않는다 — 응답 message 로 그대로 나가 화면·AI 에 내부 번호가 보였다(WP-619)
    super("태그를 찾을 수 없습니다");
  }
}
