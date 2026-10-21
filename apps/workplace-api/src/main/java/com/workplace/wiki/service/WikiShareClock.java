package com.workplace.wiki.service;

import java.time.Instant;
import org.springframework.stereotype.Component;

/**
 * 노트 공유(WP-579)가 앱에서 재는 「지금」 — 접근 요청 거절 뒤 재요청 대기 시간(24시간)의 기준과 요청 결정 시각에 쓴다. 운영은 시스템 시계다.
 *
 * <p>왜 따로 두나: 통합 테스트가 {@code @MockitoSpyBean} 으로 시각만 앞으로 옮겨 「24시간 뒤」를 실제 대기 없이 결정적으로 만든다({@code
 * AiMemoryClock} 과 같은 방식). 만료처럼 DB 시계로 판정하는 규칙은 여기를 쓰지 않는다.
 */
@Component
public class WikiShareClock {

  /** 지금 시각. */
  public Instant now() {
    return Instant.now();
  }
}
