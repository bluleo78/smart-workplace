package com.workplace.issue.service;

import java.util.Arrays;
import java.util.List;

/**
 * 목록 검색 쿼리 파라미터 정규화 공용 헬퍼. 이슈 검색({@link IssueSearchService})과 AI 작업 목록({@link
 * AiTaskSearchService})이 같은 규칙(trim·CSV·페이지 크기)을 쓰도록 한 곳에 모았다.
 */
final class SearchParams {

  private static final int DEFAULT_SIZE = 30;
  private static final int MAX_SIZE = 100;

  private SearchParams() {}

  /** 앞뒤 공백을 제거하고 빈 문자열이면 null. */
  static String trimToNull(String s) {
    if (s == null) return null;
    String t = s.trim();
    return t.isEmpty() ? null : t;
  }

  /** 쉼표 구분 값 → trim·빈 값 제외 목록. 미지정이면 빈 목록. */
  static List<String> csv(String s) {
    String t = trimToNull(s);
    if (t == null) return List.of();
    return Arrays.stream(t.split(",")).map(String::trim).filter(x -> !x.isEmpty()).toList();
  }

  /** 페이지 크기 — 기본 30, 1~100 으로 clamp, 숫자가 아니면 기본값(관대한 처리). */
  static int size(String raw) {
    String s = trimToNull(raw);
    if (s == null) return DEFAULT_SIZE;
    try {
      return Math.max(1, Math.min(MAX_SIZE, Integer.parseInt(s)));
    } catch (NumberFormatException ignored) {
      return DEFAULT_SIZE;
    }
  }
}
