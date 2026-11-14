package com.workplace.agentaccount.usage;

import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.HttpClientSettings;
import org.springframework.boot.http.client.HttpRedirects;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 사용량 조회기 빈 구성. 외부 HTTPS RestClient 를 ..outbound.. 밖에서 만든다(내부 서비스 호출 규칙의 범위 밖 — WebPushGateway 와 같은
 * 외부 호출). 연결·응답 타임아웃은 설정에서 받고, 리다이렉트는 따라가지 않는다(토큰이 든 요청이 다른 주소로 새지 않게). RestClient 자체는 빈으로 노출하지 않는다
 * — 다른 곳의 RestClient 주입과 섞이지 않게 조회기 빈 안에만 둔다.
 *
 * <p>HTTP 구현은 전역 설정(spring.http.clients.imperative.factory: jdk)과 달리 Apache HttpComponents 로
 * 고정한다(WP-1487). 10분 주기 조회는 그 사이 서버·중간 장비가 닫은 풀 연결을 다시 집어 응답 없이 멈추다 read timeout(「연결 실패」)이 났다. JDK
 * 클라이언트의 유휴 연결 수명은 JVM 전역 시스템 속성(jdk.httpclient.keepalive.timeout)뿐이라 이 클라이언트만 바꿀 수 없다. 조회는 계정마다
 * 10분에 한 번이라 연결을 다시 쓸 이득이 없으므로, 연결 재사용을 아예 끄고(요청마다 새 연결) 클라이언트 자체 자동 재시도도 끈다 — 재시도는 수집기가 NETWORK
 * 실패에만 1회 한다.
 */
@Configuration
public class AgentAccountUsageHttpConfig {

  /** Claude 조회기 — anthropic-base-url 을 base 로 하는 전용 클라이언트. */
  @Bean
  ClaudeUsageProbe claudeUsageProbe(AgentAccountUsageProperties props) {
    return new ClaudeUsageProbe(client(props.anthropicBaseUrl(), props), props);
  }

  /** ChatGPT 조회기 — chatgpt-base-url 을 base 로 하는 전용 클라이언트. */
  @Bean
  ChatgptUsageProbe chatgptUsageProbe(AgentAccountUsageProperties props) {
    return new ChatgptUsageProbe(client(props.chatgptBaseUrl(), props));
  }

  /**
   * HttpComponents 팩토리에 타임아웃을 걸고 리다이렉트를 끈 RestClient 를 만든다. 연결은 다시 쓰지 않고(응답마다 닫음) 자동 재시도도 끈다 — 오래 쉰
   * 풀 연결을 집을 일이 없고, 재시도 규칙은 수집기 한 곳에만 둔다(GET 만 몰래 여러 번 재시도되지 않게). 풀에 남는 연결이 없어 유휴 연결 정리 스레드도 필요 없다.
   */
  private static RestClient client(String baseUrl, AgentAccountUsageProperties props) {
    var settings =
        HttpClientSettings.defaults()
            .withConnectTimeout(props.connectTimeout())
            .withReadTimeout(props.readTimeout())
            .withRedirects(HttpRedirects.DONT_FOLLOW);
    var factoryBuilder =
        ClientHttpRequestFactoryBuilder.httpComponents()
            .withHttpClientCustomizer(
                b ->
                    b.setConnectionReuseStrategy((request, response, context) -> false)
                        .disableAutomaticRetries());
    return RestClient.builder()
        .baseUrl(baseUrl)
        .requestFactory(factoryBuilder.build(settings))
        .build();
  }
}
