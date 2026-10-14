package com.workplace.home.service;

import java.util.List;
import java.util.Map;

/**
 * AI 메모리 범위(WP-379) — 공통(DB NULL) 또는 앱 하나. 코드·화면 이름의 단일 원본이다(ai-agent memory-block.ts 의
 * memoryScopeSchema·MEMORY_SCOPE_LABEL, 웹 lib/aiMemory.ts 의 MEMORY_SCOPES 와 같은 목록 — 바꾸면 셋을 함께 바꾼다).
 *
 * <p>오류 응답(errors.scope)에서는 공통을 {@link #COMMON} 으로 싣는다 — Map 에 null 을 둘 수 없고, 웹이 "범위 정보 없음"(구 API)과
 * 구분한다.
 */
public final class AiMemoryScope {

  /** 앱 범위 코드 — 화면 순서(이슈 → 노트 → 메일 → 드라이브 → 메신저 → 캘린더). */
  public static final List<String> APPS =
      List.of("ISSUE", "WIKI", "MAIL", "DRIVE", "MESSAGING", "CALENDAR");

  /** 오류 응답에서 공통을 가리키는 값(DB·요청 본문에서는 null 이 공통이다). */
  public static final String COMMON = "COMMON";

  private static final Map<String, String> LABELS =
      Map.of(
          "ISSUE", "이슈",
          "WIKI", "노트",
          "MAIL", "메일",
          "DRIVE", "드라이브",
          "MESSAGING", "메신저",
          "CALENDAR", "캘린더");

  private AiMemoryScope() {}

  /** 6개 앱 코드 중 하나인가. */
  public static boolean isApp(String code) {
    return code != null && LABELS.containsKey(code);
  }

  /** 앱 코드면 그대로, 아니면(null·모르는 값) null — 홈 채팅의 "지금 화면 앱"을 관대하게 받는다(판정 12). */
  public static String appOrNull(String code) {
    return isApp(code) ? code : null;
  }

  /** 화면 이름 — null 은 "공통". 오류 문구·로그에 쓴다. */
  public static String label(String scope) {
    return scope == null ? "공통" : LABELS.getOrDefault(scope, scope);
  }
}
