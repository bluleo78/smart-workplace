package com.workplace.home.outbound;

import com.workplace.global.outbound.AiAgentProperties;
import java.time.Duration;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/** AiAgentPriorityClient 빈 등록 — IssueAiConfig 와 동일 ai-agent 인스턴스/토큰(AiAgentProperties) 재사용. */
@Configuration
public class PriorityAiConfig {

  /**
   * 우선순위 분류 전용 RestClient 를 구성한다.
   *
   * <p>connect 5s / read 90s — read timeout 은 ai-agent 의 LLM 예산을 반드시 초과해야 한다(IssueAiConfig 미러).
   */
  @Bean
  public AiAgentPriorityClient aiAgentPriorityClient(AiAgentProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(Duration.ofSeconds(5))
            .withReadTimeout(Duration.ofSeconds(90));
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
    var builder = RestClient.builder().baseUrl(props.baseUrl()).requestFactory(factory);
    return new AiAgentPriorityClient(builder, props.internalToken());
  }
}
