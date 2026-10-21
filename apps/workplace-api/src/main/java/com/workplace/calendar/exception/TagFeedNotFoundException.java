package com.workplace.calendar.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/** 태그에 구독 주소가 아직 없음(WP-715) — 404. 화면은 이때 「구독 주소 만들기」를 보인다. */
@ResponseStatus(HttpStatus.NOT_FOUND)
public class TagFeedNotFoundException extends RuntimeException {
  public TagFeedNotFoundException() {
    super("구독 주소가 없습니다");
  }
}
