package com.workplace.fileai.outbound;

import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

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
   * 기본값(HTTP/2)으로 평문 호출하면 h2c 업그레이드 헤더를 보내 워커가 400("Invalid HTTP request")으로 거부한다. 다른 내부
   * 클라이언트(WorkerEmbedClient·DriveOverviewStreamClient)와 동일하게 HTTP_1_1 로 고정한다.
   */
  @Bean
  public WorkerClient workerClient(WorkerProperties props) {
    HttpClient httpClient =
        HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofSeconds(5))
            .build();
    var factory = new JdkClientHttpRequestFactory(httpClient);
    factory.setReadTimeout(Duration.ofSeconds(60));
    var restClient = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory).build();
    return new WorkerClient(restClient, props.internalToken());
  }
}
