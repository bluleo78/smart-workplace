package com.workplace.global.realtime.relay;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * SSE 중계 구현 선택(WP-1973) — 속성값으로 두 구현 중 하나만 빈이 된다.
 *
 * <p>{@code app.realtime.relay.enabled=false} 이면 로컬 직행 {@link NoopSseEventRelay}(테스트 프로파일 — 기존 통합
 * 테스트 보호), 그 외(명시 true · 속성 없음)는 PostgreSQL NOTIFY 인 {@link PostgresSseEventRelay} — 로컬·운영의 기본값은
 * 켜짐이다.
 */
@Configuration
public class SseRelayConfiguration {

  /** 중계 끄기 구현 — publish 를 곧바로 로컬 수신자에게 넘겨 지금과 같은 동작을 유지한다. */
  @Bean
  @ConditionalOnProperty(name = "app.realtime.relay.enabled", havingValue = "false")
  public SseEventRelay noopSseEventRelay() {
    return new NoopSseEventRelay();
  }

  /**
   * 중계 켜기 구현 — 발행 전용 커넥션 정보를 앱과 같은 datasource 로 주입한다. 속성이 아예 없는 프로파일(local·운영 기본)에서도 빈이 되게
   * matchIfMissing 으로 기본값을 켜짐으로 둔다 — 없으면 레지스트리·중계 배선이 SseEventRelay 빈을 못 찾아 컨텍스트 기동이 실패한다.
   */
  @Bean
  @ConditionalOnProperty(
      name = "app.realtime.relay.enabled",
      havingValue = "true",
      matchIfMissing = true)
  public SseEventRelay postgresSseEventRelay(
      @Value("${spring.datasource.url}") String url,
      @Value("${spring.datasource.username}") String username,
      @Value("${spring.datasource.password}") String password) {
    return new PostgresSseEventRelay(url, username, password);
  }
}
