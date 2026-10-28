package com.workplace.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/**
 * 가짜 임베딩을 TextEmbedder 의 @Primary 로 끼운다(WP-383 판정 6). {@link IntegrationTestBase} 가 모든 통합 테스트에 공통으로
 * {@code @Import} 한다 — 필요한 클래스만 붙이면 그 유무로 컨텍스트가 갈라진다(WP-115, WP-1028). drive 는 WorkerEmbedClient 를
 * 구체 타입으로 주입받으므로 영향이 없다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class FakeTextEmbedderConfig {

  @Bean
  @Primary
  public FakeTextEmbedder fakeTextEmbedder() {
    return new FakeTextEmbedder();
  }
}
