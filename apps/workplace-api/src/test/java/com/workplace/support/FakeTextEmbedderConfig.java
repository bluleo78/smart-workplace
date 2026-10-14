package com.workplace.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 가짜 임베딩을 TextEmbedder 의 @Primary 로 끼운다(WP-383 판정 6). 임베딩이 필요한 테스트만 {@code @Import} 하고, 모두 같은 구성이라
 * 컨텍스트 하나를 나눠 쓴다(클래스마다 @MockitoBean 이면 컨텍스트가 갈라진다 — WP-115). drive 는 WorkerEmbedClient 를 구체 타입으로
 * 주입받으므로 영향이 없다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class FakeTextEmbedderConfig {

  @Bean
  @Primary
  public FakeTextEmbedder fakeTextEmbedder() {
    return new FakeTextEmbedder();
  }
}
