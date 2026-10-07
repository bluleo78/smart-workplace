package com.workplace.wiki.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 노트 요약 전용 RestClient 빈(AiAgentDriveConfig 미러). read timeout 200s — 비서 timeoutMs 상한(180s)보다 길게 두어
 * 느리지만 성공한 요청을 api 가 먼저 끊지 않게 한다.
 */
@Configuration
public class WikiAiAgentSummaryConfig {

  @Bean
  public WikiAiAgentSummaryClient wikiAiAgentSummaryClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(200));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var restClient = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory).build();
    return new WikiAiAgentSummaryClient(restClient, props.internalToken());
  }
}
