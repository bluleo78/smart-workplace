package com.workplace.wiki.report;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * 「보고서 만들기」 하루 상한(WP-1486 P12)을 넘었다 — AI 비용을 묶으려고 사람마다 서울 날짜 하루 20번까지만 받는다. 공용 처리기가 선언된 상태(429)와 이
 * 문구로 응답한다(업무 프로파일 「다시 분석」 상한과 같은 모양).
 */
@ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
public class PersonalReportDailyLimitException extends RuntimeException {
  public PersonalReportDailyLimitException() {
    super("오늘은 보고를 더 만들 수 없어요");
  }
}
