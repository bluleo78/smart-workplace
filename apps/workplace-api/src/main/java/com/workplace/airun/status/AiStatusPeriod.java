package com.workplace.airun.status;

import java.time.Duration;

/** AI 현황 조회 기간(WP-1831). 기간 길이와 시계열 구간(bucket) 크기를 한 곳에 묶어, 어느 기간이든 차트 점 수가 비슷하게(12~30개) 나오게 한다. */
public enum AiStatusPeriod {
  H1("1h", Duration.ofHours(1), Duration.ofMinutes(5)),
  H24("24h", Duration.ofHours(24), Duration.ofHours(1)),
  D7("7d", Duration.ofDays(7), Duration.ofHours(6)),
  D30("30d", Duration.ofDays(30), Duration.ofDays(1));

  private final String code;
  private final Duration length;
  private final Duration bucket;

  AiStatusPeriod(String code, Duration length, Duration bucket) {
    this.code = code;
    this.length = length;
    this.bucket = bucket;
  }

  /** 기간 전체 길이. */
  public Duration length() {
    return length;
  }

  /** 시계열 한 구간의 크기. */
  public Duration bucket() {
    return bucket;
  }

  /** 요청·응답에 쓰는 기간 코드(1h·24h·7d·30d). */
  public String code() {
    return code;
  }

  /**
   * 기간 코드를 해석한다. 생략(null)은 24시간, 그 밖의 값은 400 으로 바뀔 IllegalArgumentException — 빈 문자열도 「그 밖」이다. 기간
   * 코드는 값이 있어야 뜻이 있어 「주지 않음」으로 보지 않는다(파라미터 처리를 나머지 문자열 파라미터와 다르게 하는 의도 — AdminAiStatusController
   * 참고).
   */
  public static AiStatusPeriod parse(String code) {
    if (code == null) {
      return H24;
    }
    for (AiStatusPeriod p : values()) {
      if (p.code.equals(code)) {
        return p;
      }
    }
    throw new IllegalArgumentException("기간은 1h·24h·7d·30d 중 하나여야 합니다");
  }
}
