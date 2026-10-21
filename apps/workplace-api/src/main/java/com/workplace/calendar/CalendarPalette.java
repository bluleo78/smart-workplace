package com.workplace.calendar;

import java.util.List;
import java.util.Locale;
import java.util.Set;

/** 캘린더/일정 색 고정 팔레트(키). 자유 hex 미지원 — UI·검증·테마 매핑의 단일 원본. */
public final class CalendarPalette {
  private CalendarPalette() {}

  /** 기본 캘린더 색. */
  public static final String DEFAULT = "blue";

  /**
   * 팔레트 키 순서 — 프론트 {@code calendarPalette.ts} 의 ENTRIES 순서와 같다. 이름 해시로 색을 고르는 {@link #forName} 이 이
   * 순서에 기대므로(프론트 {@code pickTagColor} 와 같은 답) 바꾸면 양쪽을 함께 바꾼다.
   */
  public static final List<String> ORDERED_KEYS =
      List.of("blue", "green", "red", "amber", "violet", "pink", "teal", "gray");

  /** 허용 색 키 8종. */
  public static final Set<String> KEYS = Set.copyOf(ORDERED_KEYS);

  /** 팔레트에 속한 키인지. null 은 false. */
  public static boolean isValid(String key) {
    return key != null && KEYS.contains(key);
  }

  /**
   * 이름에서 팔레트 키를 정한다(WP-714) — 같은 이름은 항상 같은 색. 사용자가 색을 고르지 않은 새 태그(Outlook 범주에서 온 태그 포함)의 기본 색이다.
   *
   * <p>프론트 {@code pickTagColor}(lib/calendarTag.ts)와 같은 답을 내야 한다: 앞뒤 공백을 떼고 소문자로 바꾼 뒤 {@code h =
   * h*31 + 글자}(32비트 부호 없는) 해시 % 8. 자바 {@link String#hashCode} 는 같은 식의 부호 있는 값이라 부호 없는 값으로 바꿔 쓴다.
   */
  public static String forName(String name) {
    String key = name == null ? "" : name.strip().toLowerCase(Locale.ROOT);
    long h = Integer.toUnsignedLong(key.hashCode());
    return ORDERED_KEYS.get((int) (h % ORDERED_KEYS.size()));
  }
}
