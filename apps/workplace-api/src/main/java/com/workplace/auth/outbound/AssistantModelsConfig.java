package com.workplace.auth.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 모델 프로브 전용 RestClient 빈 — connect 5s / read 15s(ai-agent 프로브 타임아웃 10s 초과 보장), 무재시도. IssueAiConfig
 * 미러.
 */
@Configuration
public class AssistantModelsConfig {

  @Bean
  public AiAgentModelsClient aiAgentModelsClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(15));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var builder = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory);
    return new AiAgentModelsClient(builder, props.internalToken());
  }
}
