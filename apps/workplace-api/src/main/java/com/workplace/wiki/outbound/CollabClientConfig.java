package com.workplace.wiki.outbound;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.concurrent.Executor;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.client.RestClient;

/** 노트 동기화 서버 연동 빈 — {@link CollabClient} 와 재검증 알림 전용 executor(WP-285). */
@Configuration
public class CollabClientConfig {

  /**
   * connect 3s / read 15s. apply-markdown 은 동기화 서버가 문서를 메모리에 올리고(필요 시 API 에서 로드) 즉시 저장까지 마친 뒤 응답하므로
   * 일반 내부 호출보다 read 를 넉넉히 둔다. 요청 팩토리는 JDK HttpClient 를 HTTP/1.1 로 고정한다(h2c 업그레이드 404 방지).
   */
  @Bean
  public CollabClient collabClient(CollabProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(3))
            .withReadTimeout(Duration.ofSeconds(15));
    // HTTP/1.1 고정 — JDK HttpClient 기본(HTTP/2)은 평문 http 요청에 Connection: Upgrade, HTTP2-Settings /
    // Upgrade: h2c 를 붙인다. 동기화 서버(Node)는 WebSocket upgrade 리스너가 있어 이를 업그레이드 요청으로 보고 404 로
    // 거절했다(모든 apply-markdown·revalidate 실패). 내부 호출에 HTTP/2 이득도 없으므로 업그레이드 시도 자체를 끈다.
    var factory =
        ClientHttpRequestFactoryBuilder.jdk()
            .withHttpClientCustomizer(b -> b.version(HttpClient.Version.HTTP_1_1))
            .build(settings);
    var builder = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory);
    return new CollabClient(builder, props.internalToken());
  }

  /**
   * 재검증 알림 전용 executor. 커밋 후 HTTP 호출이 요청 스레드를 붙잡지 않도록(동기화 서버 장애 시 최대 타임아웃만큼 응답 지연) 분리한다. 이벤트가
   * tenantId 를 직접 싣고 DB 를 건드리지 않으므로 TenantContext 전파 데코레이터는 필요 없다. bare {@code @Async} 의 무제한 폴백을
   * 피하려고 이름으로 한정해 쓴다.
   */
  @Bean(name = "wikiCollabRevalidateExecutor")
  public Executor wikiCollabRevalidateExecutor() {
    ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
    executor.setCorePoolSize(1);
    executor.setMaxPoolSize(2);
    executor.setQueueCapacity(500);
    executor.setThreadNamePrefix("wiki-collab-");
    executor.initialize();
    return executor;
  }
}
