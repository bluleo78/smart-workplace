package com.workplace.home.service;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import org.springframework.stereotype.Component;

/**
 * AI 메모리의 "오늘"(WP-380) — 기한 당일까지 유효, 다음 날부터 만료. 사용자가 보는 날짜가 한국 날짜라 Asia/Seoul 로 판정한다. 컨트롤러 expired·
 * 한도·주입·ChatRequest.today·정리 배치가 모두 이 하나를 쓴다(DB CURRENT_DATE 를 쓰지 않는다 — 세션 시간대에 따라 달라질 수 있다). 통합
 * 테스트는 {@code @MockitoBean} 으로 날짜를 고정한다.
 */
@Component
public class AiMemoryClock {

  /** 메모리 날짜 기준 시간대 id — 컴파일 상수라 정리 배치의 {@code @Scheduled(zone = …)} 도 같은 값을 쓴다. */
  public static final String ZONE_ID = "Asia/Seoul";

  /** 메모리 날짜 기준 시간대. */
  public static final ZoneId ZONE = ZoneId.of(ZONE_ID);

  private final Clock clock;

  /** 운영 — 시스템 시계(Asia/Seoul). 생성자가 둘이라 Spring 은 이 무인자 생성자를 쓴다. */
  public AiMemoryClock() {
    this(Clock.system(ZONE));
  }

  /** 단위 테스트용 고정 시계. */
  AiMemoryClock(Clock clock) {
    this.clock = clock;
  }

  /** 오늘(Asia/Seoul). */
  public LocalDate today() {
    return LocalDate.now(clock);
  }
}
