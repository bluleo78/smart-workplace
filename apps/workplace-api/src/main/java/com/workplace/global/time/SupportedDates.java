package com.workplace.global.time;

import java.time.LocalDate;

/**
 * 앱이 받는 날짜(LocalDate)의 공통 범위 — 1900-01-01 ~ 9999-12-31 (WP-725).
 *
 * <p>LocalDate 는 부호 붙은 큰 연도(+10000-01-01)·음수 연도(-0001-01-01)도 읽는다. 10000년 이후는 저장돼도 웹 날짜 표시가 해석하지 못해
 * 이슈 상세 화면이 통째로 깨졌고, DB 범위를 넘으면 영어 409, 음수 연도는 다른 날짜로 바뀌어 저장됐다. 화면 날짜 선택기로는 고를 수 없는 값이라 API·MCP
 * 입력에서 막는다.
 */
public final class SupportedDates {

  public static final LocalDate MIN = LocalDate.of(1900, 1, 1);
  public static final LocalDate MAX = LocalDate.of(9999, 12, 31);

  /** 범위를 벗어난 날짜를 거절할 때의 문구 — 화면 토스트로 그대로 나간다. */
  public static final String MESSAGE = "날짜는 1900-01-01 ~ 9999-12-31 사이여야 합니다";

  private SupportedDates() {}

  /** 범위 안의 날짜인가(null 은 판정하지 않는다 — 호출부가 비움을 따로 다룬다). */
  public static boolean isSupported(LocalDate date) {
    return !date.isBefore(MIN) && !date.isAfter(MAX);
  }
}
