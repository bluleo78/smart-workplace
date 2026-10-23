package com.workplace.issue.service;

import com.workplace.issue.dto.IssueStatuses;
import com.workplace.issue.exception.InvalidIssueFilterException;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * 목록 검색 쿼리 파라미터 정규화 공용 헬퍼. 이슈 검색({@link IssueSearchService})과 AI 작업 목록({@link
 * AiTaskSearchService})이 같은 규칙(trim·CSV·페이지 크기)을 쓰도록 한 곳에 모았다.
 */
final class SearchParams {

  /** 이슈 상태 값 — DB CHECK(V5) 와 같은 집합, 오류 문구에 이 순서로 나열한다. */
  private static final List<String> STATUSES = IssueStatuses.CATEGORY_ORDER;

  /** 이슈 우선순위 값 — DB CHECK(V5) 와 같은 집합. */
  private static final List<String> PRIORITIES = List.of("LOW", "MID", "HIGH");

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

  /** status 필터 CSV — {@link #enumCsv} 규칙. */
  static List<String> statuses(String raw) {
    return enumCsv("status", "상태", raw, STATUSES);
  }

  /** priority 필터 CSV — {@link #enumCsv} 규칙. */
  static List<String> priorities(String raw) {
    return enumCsv("priority", "우선순위", raw, PRIORITIES);
  }

  /**
   * 정해진 값만 받는 필터 CSV(WP-661). 대소문자만 다르면 정식 값(대문자)으로 맞추고, 없는 값은 사용 가능 값과 함께 {@link
   * InvalidIssueFilterException}(400)으로 거부한다 — 예전엔 그대로 SQL 에 넣어 "맞는 이슈 없음" 빈 목록이 정답처럼 나갔다(라벨·유형 이름
   * #841 과 같은 규칙).
   */
  private static List<String> enumCsv(String field, String kind, String raw, List<String> allowed) {
    List<String> values = csv(raw).stream().map(v -> v.toUpperCase(Locale.ROOT)).toList();
    for (String v : values) {
      if (!allowed.contains(v)) {
        throw new InvalidIssueFilterException(
            field, kind + " '" + v + "' 은(는) 없는 값입니다. 사용 가능: " + String.join(", ", allowed));
      }
    }
    return values;
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
