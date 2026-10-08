package com.workplace.fileai.outbound;

import com.workplace.global.outbound.InternalHttp;
import java.time.Duration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 워커 서비스용 RestClient 빈 — MailAiConfig 미러. connect 5s / read 60s. */
@Configuration
@EnableConfigurationProperties(WorkerProperties.class)
public class WorkerClientConfig {

  /**
   * 워커 서비스 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 60s — 워커의 추출 작업(PDF 파싱 등) 예산을 수용한다.
   *
   * <p>HTTP/1.1 고정: 워커는 uvicorn(h11) 으로 HTTP/2 cleartext(h2c) 업그레이드를 지원하지 않는다. JDK HttpClient
   * 기본값(HTTP/2)으로 평문 호출하면 h2c 업그레이드 헤더를 보내 워커가 400("Invalid HTTP request")으로 거부한다. 다른 내부 클라이언트와
   * 동일하게 공용 생성 지점({@link InternalHttp})에서 HTTP_1_1 로 고정한다(WP-305).
   */
  @Bean
  public WorkerClient workerClient(WorkerProperties props) {
    var restClient =
        InternalHttp.restClient(props.baseUrl(), Duration.ofSeconds(5), Duration.ofSeconds(60))
            .build();
    return new WorkerClient(restClient, props.internalToken());
  }
}
