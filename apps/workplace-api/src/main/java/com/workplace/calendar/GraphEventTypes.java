package com.workplace.calendar;

/**
 * Graph 일정 종류(event.type) 값(WP-716) — 동기화가 {@code calendar_event.external_type} 에 그대로 저장하고, 태그 써
 * 넣기가 그 값으로 범주를 쓸 대상을 정한다. 같은 문자열을 여러 곳에 흩어 쓰지 않도록 한곳에 둔다.
 */
public final class GraphEventTypes {

  private GraphEventTypes() {}

  /** 반복되지 않는 단일 일정. */
  public static final String SINGLE_INSTANCE = "singleInstance";

  /** 반복 회의의 보통 회차 — 시리즈 마스터를 그대로 따른다. */
  public static final String OCCURRENCE = "occurrence";

  /** 반복 회의에서 따로 고친 회차 — 자기 범주를 따로 가질 수 있다. */
  public static final String EXCEPTION = "exception";

  /** 반복 회의의 시리즈 마스터. */
  public static final String SERIES_MASTER = "seriesMaster";
}
