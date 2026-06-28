package com.workplace.fileai.outbound;

import java.time.Duration;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** 워커 서비스용 RestClient 빈 — MailAiConfig 미러. connect 5s / read 60s. */
@Configuration
@EnableConfigurationProperties(WorkerProperties.class)
public class WorkerClientConfig {

  /**
   * 워커 서비스 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 60s — 워커의 추출 작업(PDF 파싱 등) 예산을 수용한다. Spring Boot 3.4 의 비-deprecated
   * API({@code org.springframework.boot.http.client.*}) 로 팩토리를 생성한다.
   */
  @Bean
  public WorkerClient workerClient(WorkerProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(60));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var restClient = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory).build();
    return new WorkerClient(restClient, props.internalToken());
  }
}
