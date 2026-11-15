package com.workplace.issue.service;

import com.workplace.issue.dto.IssueDueWindow;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * 이슈 마감 판정의 「오늘」·「지금」(WP-1617). JVM 기본 시간대가 UTC 라 {@code LocalDate.now()} 를 쓰면 KST 00~09시에 하루 전 날짜가
 * 되므로, 이슈 마감의 하루 경계는 {@link IssueDueWindow#today(Clock)} 로 Asia/Seoul 날짜에 맞춘다. 통합 테스트는 공유 spy 로 이
 * 빈의 값을 고정한다.
 */
@Component
public class IssueClock {

  private final Clock clock;

  /** 운영 — 시스템 UTC 시계(날짜 변환은 {@link #today()} 가 서울로). 생성자가 둘이라 Spring 은 이 무인자 생성자를 쓴다. */
  @Autowired
  public IssueClock() {
    this(Clock.systemUTC());
  }

  /** 단위 테스트용 고정 시계. */
  public IssueClock(Clock clock) {
    this.clock = clock;
  }

  /** 오늘(Asia/Seoul) — 마감 임박/경과(OVERDUE) 기준일. */
  public LocalDate today() {
    return IssueDueWindow.today(clock);
  }

  /** 현재 시각 — 정체(STALE) 기준. */
  public Instant now() {
    return clock.instant();
  }
}
