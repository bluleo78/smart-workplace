package com.workplace.global.net;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** {@link SafeHttpFetcher} 운영 빈 — 실제 DNS, 신뢰 호스트 없음. 종료 시 close() 가 커넥션 풀을 닫는다. */
@Configuration
public class SafeHttpFetcherConfig {

  @Bean
  public SafeHttpFetcher safeHttpFetcher() {
    return new SafeHttpFetcher();
  }
}
