package com.workplace.calendar.dto;

/** M365 일정의 Outlook 범주가 붙는 단위(WP-716) — JSON 으로는 이름 그대로 {@code "EVENT"}·{@code "SERIES"} 로 나간다. */
public enum OutlookTagScope {
  /** 이 일정 하나. */
  EVENT,
  /** 반복 회의 시리즈 전체 — 회차에서 바꿔도 시리즈에 붙는다. */
  SERIES
}
