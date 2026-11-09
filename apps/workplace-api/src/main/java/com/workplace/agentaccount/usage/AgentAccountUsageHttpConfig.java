package com.workplace.agentaccount.usage;

import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 사용량 조회기 빈 구성. 외부 HTTPS RestClient 를 ..outbound.. 밖에서 만든다(내부 서비스 호출 규칙의 범위 밖 — WebPushGateway 와 같은
 * 외부 호출). 연결·응답 타임아웃은 설정에서 받고, 리다이렉트는 따라가지 않는다(토큰이 든 요청이 다른 주소로 새지 않게). RestClient 자체는 빈으로 노출하지 않는다
 * — 다른 곳의 RestClient 주입과 섞이지 않게 조회기 빈 안에만 둔다.
 */
@Configuration
public class AgentAccountUsageHttpConfig {

  /** Claude 조회기 — anthropic-base-url 을 base 로 하는 전용 클라이언트. */
  @Bean
  ClaudeUsageProbe claudeUsageProbe(
      AgentAccountUsageProperties props, ClientHttpRequestFactoryBuilder<?> factoryBuilder) {
    return new ClaudeUsageProbe(client(props.anthropicBaseUrl(), props, factoryBuilder), props);
  }

  /** ChatGPT 조회기 — chatgpt-base-url 을 base 로 하는 전용 클라이언트. */
  @Bean
  ChatgptUsageProbe chatgptUsageProbe(
      AgentAccountUsageProperties props, ClientHttpRequestFactoryBuilder<?> factoryBuilder) {
    return new ChatgptUsageProbe(client(props.chatgptBaseUrl(), props, factoryBuilder));
  }

  /** JDK 팩토리(spring.http.client.factory)에 타임아웃을 걸고 리다이렉트를 끈 RestClient 를 만든다. */
  private static RestClient client(
      String baseUrl,
      AgentAccountUsageProperties props,
      ClientHttpRequestFactoryBuilder<?> factoryBuilder) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(props.connectTimeout())
            .withReadTimeout(props.readTimeout())
            .withRedirects(ClientHttpRequestFactorySettings.Redirects.DONT_FOLLOW);
    return RestClient.builder()
        .baseUrl(baseUrl)
        .requestFactory(factoryBuilder.build(settings))
        .build();
  }
}
