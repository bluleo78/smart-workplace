package com.workplace.issue.overview.status;

import java.time.Duration;

/**
 * 프로젝트 상태 AI 요약의 갱신 간격(WP-1479) — 프로젝트 설정 {@code status_summary_interval} 의 값. 기본은 {@link #H2}.
 * DAILY 는 「하루 한 번」으로 24시간 간격이다.
 */
public enum StatusSummaryInterval {
  H1(Duration.ofHours(1)),
  H2(Duration.ofHours(2)),
  H4(Duration.ofHours(4)),
  DAILY(Duration.ofHours(24));

  private final Duration duration;

  StatusSummaryInterval(Duration duration) {
    this.duration = duration;
  }

  /**
   * 저장·요청 값을 간격으로 바꾼다 — 모르는 값(null 포함)이면 기본 {@link #H2}. DB CHECK 와 요청 @Pattern 이 이미 막지만, 롤링 배포 중
   * 다른 버전이 새 값을 적었거나 검증을 거치지 않은 경로가 생겨도 스케줄러·설정 저장이 예외로 멈추지 않게 기본값으로 받아 준다.
   */
  public static StatusSummaryInterval parse(String value) {
    if (value == null) return H2;
    try {
      return valueOf(value);
    } catch (IllegalArgumentException e) {
      return H2;
    }
  }

  /** 다음 요약까지의 간격. */
  public Duration duration() {
    return duration;
  }
}
