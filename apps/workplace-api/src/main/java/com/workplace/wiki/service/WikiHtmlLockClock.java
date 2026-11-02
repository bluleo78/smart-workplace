package com.workplace.wiki.service;

import java.time.Instant;
import org.springframework.stereotype.Component;

/**
 * 「HTML 문서」 편집 잠금(WP-1308)이 재는 「지금」 — 잠금을 얻은·마지막 입력 시각을 찍고, 입력이 10분 없었는지 판정한다. 운영은 시스템 시계다.
 *
 * <p>왜 따로 두나: 통합 테스트가 {@code @MockitoSpyBean} 으로 시각만 앞으로 옮겨 「10분 뒤」를 실제 대기 없이 결정적으로 만든다({@link
 * WikiShareClock} 과 같은 방식). 찍는 쪽과 판정하는 쪽이 같은 시계를 써야 하므로 DB now() 대신 이것만 쓴다.
 */
@Component
public class WikiHtmlLockClock {

  /** 지금 시각. */
  public Instant now() {
    return Instant.now();
  }
}
