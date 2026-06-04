package com.workplace.mail.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** 메일 AI 전용 RestClient 빈 — connect 5s / read 90s(ai-agent CLI 예산 초과 보장), 무재시도. */
@Configuration
public class MailAiConfig {

  /**
   * 메일 AI 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 90s — read timeout 은 ai-agent 의 CLI 예산(DEFAULT_TIMEOUT_MS=60s)을 반드시 초과해야
   * 한다. 같으면 CLI 가 풀-런 후 파싱·응답을 마치기 전에 api 측이 먼저 끊어, 느리지만 성공한 요청이 잘릴 수 있다. 재시도 로직은 두지 않는다(무재시도).
   * Spring Boot 3.4 의 비-deprecated API({@code org.springframework.boot.http.client.*}) 로 팩토리를 생성한다.
   */
  @Bean
  public AiAgentMailClient aiAgentMailClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(90));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var builder = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory);
    return new AiAgentMailClient(builder, props.internalToken());
  }
}
