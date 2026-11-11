package com.workplace.issue.profile;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 「다시 분석」 하루 상한(WP-1485)을 넘었다 — AI 비용을 묶으려고 사람×기간마다 서울 날짜 하루 10번까지만 받는다. 공용 처리기가 선언된 상태(429)와 이 문구로
 * 응답한다.
 */
@ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
public class WorkProfileDailyLimitException extends RuntimeException {
  public WorkProfileDailyLimitException() {
    super("오늘은 더 분석할 수 없어요");
  }
}
