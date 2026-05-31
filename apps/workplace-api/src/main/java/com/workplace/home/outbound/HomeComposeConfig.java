package com.workplace.home.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** 홈 컴포즈 전용 RestClient Bean — read timeout 60s(CLI cold-start 수용), 무재시도. */
@Configuration
public class HomeComposeConfig {

  /**
   * 컴포즈 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 60s — CLI cold-start(10~30s) 동기 호출을 수용. 재시도 로직은 두지 않는다(무재시도). Spring Boot
   * 3.4 의 비-deprecated API({@code org.springframework.boot.http.client.*}) 로 팩토리를 생성한다.
   */
  @Bean
  public AiAgentComposeClient aiAgentComposeClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(60));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var builder = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory);
    return new AiAgentComposeClient(builder, props.internalToken());
  }
}
