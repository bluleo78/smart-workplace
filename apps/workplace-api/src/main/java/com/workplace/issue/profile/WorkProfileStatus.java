package com.workplace.issue.profile;

/** 업무 프로파일 행의 상태(WP-1485) — 분석 완료 / 분석 중 / 마지막 분석 실패. DB CHECK 와 같은 값. */
public enum WorkProfileStatus {
  READY,
  PENDING,
  FAILED
}
