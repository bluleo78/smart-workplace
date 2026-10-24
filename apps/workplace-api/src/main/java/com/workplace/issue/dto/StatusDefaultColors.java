package com.workplace.issue.dto;

/**
 * 상태 범주별 기본 색(WP-809) — 색을 고르지 않고 만든 상태와 V206 백필·시드 트리거가 쓰는 값. TODO·CANCELED 는 GRAY, IN_PROGRESS 는
 * BLUE, DONE 은 GREEN(웹의 범주 아이콘 색과 같은 계열).
 */
public final class StatusDefaultColors {
  private StatusDefaultColors() {}

  /** 범주의 기본 색 토큰. 모르는 범주는 GRAY. */
  public static String of(String category) {
    return switch (category) {
      case IssueStatuses.IN_PROGRESS -> "BLUE";
      case IssueStatuses.DONE -> "GREEN";
      default -> "GRAY";
    };
  }
}
