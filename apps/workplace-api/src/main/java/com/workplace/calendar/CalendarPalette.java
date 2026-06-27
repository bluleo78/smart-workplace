package com.workplace.calendar;

import java.util.Set;

/** 캘린더/일정 색 고정 팔레트(키). 자유 hex 미지원 — UI·검증·테마 매핑의 단일 원본. */
public final class CalendarPalette {
  private CalendarPalette() {}

  /** 기본 캘린더 색. */
  public static final String DEFAULT = "blue";

  /** 허용 색 키 8종. */
  public static final Set<String> KEYS =
      Set.of("blue", "green", "red", "amber", "violet", "pink", "teal", "gray");

  /** 팔레트에 속한 키인지. null 은 false. */
  public static boolean isValid(String key) {
    return key != null && KEYS.contains(key);
  }
}
