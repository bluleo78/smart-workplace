package com.workplace.global.exception;

import com.workplace.global.time.SupportedDates;

/** 지원 범위(1900-01-01 ~ 9999-12-31) 밖의 날짜를 받았을 때(400, WP-725). */
public class UnsupportedDateException extends RuntimeException {
  public UnsupportedDateException() {
    super(SupportedDates.MESSAGE);
  }
}
