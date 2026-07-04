package com.workplace.issue.exception;

import java.time.LocalDate;

/** 시작일이 마감일보다 늦게 지정된 경우 — 400. 타임라인 간트뷰 정합성 가드. */
public class InvalidIssueDateRangeException extends RuntimeException {
  public InvalidIssueDateRangeException(LocalDate startDate, LocalDate dueDate) {
    super("시작일(" + startDate + ")은 마감일(" + dueDate + ")보다 늦을 수 없습니다");
  }
}
