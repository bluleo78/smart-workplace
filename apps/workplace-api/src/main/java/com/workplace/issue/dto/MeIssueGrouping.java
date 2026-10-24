package com.workplace.issue.dto;

import com.workplace.issue.exception.InvalidIssueFilterException;
import java.util.Locale;

/**
 * /me/issues 프로젝트 묶음 정렬 기준(WP-915, opt-in {@code group} 파라미터). 한 프로젝트의 행을 연속으로 내려 화면이 프로젝트 구간을 무한
 * 스크롤로 이어 그릴 수 있게 한다.
 *
 * <ul>
 *   <li>{@link #DUE} — 열린 이슈의 가장 이른 마감이 빠른 프로젝트 먼저, 묶음 안은 열린 것 → 마감 빠른 순 → 최근 수정 순(내 담당).
 *   <li>{@link #RECENT} — 가장 최근에 수정된 이슈가 있는 프로젝트 먼저, 묶음 안은 최근 수정 순(내가 만든·구독).
 * </ul>
 */
public enum MeIssueGrouping {
  DUE,
  RECENT;

  /** 파라미터 값 해석 — 없으면 null(기존 정렬), due·recent(대소문자 무관)가 아니면 400. */
  public static MeIssueGrouping parse(String raw) {
    if (raw == null || raw.isBlank()) return null;
    return switch (raw.trim().toLowerCase(Locale.ROOT)) {
      case "due" -> DUE;
      case "recent" -> RECENT;
      default ->
          throw new InvalidIssueFilterException("group", "group 은 due·recent 중 하나여야 합니다: " + raw);
    };
  }
}
