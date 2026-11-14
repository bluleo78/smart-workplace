package com.workplace.agentaccount.refresh;

import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.HttpClientSettings;
import org.springframework.boot.http.client.HttpRedirects;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * 갱신 클라이언트 빈 구성(WP-1450). 외부 HTTPS RestClient 를 ..outbound.. 밖에서 만든다(내부 서비스 호출 규칙의 범위 밖 — 외부 호출).
 * 타임아웃은 설정에서 받고 리다이렉트는 따라가지 않는다(갱신 토큰이 든 요청이 다른 주소로 새지 않게). RestClient 는 빈으로 노출하지 않고 클라이언트 안에만 둔다.
 */
@Configuration
public class LoginRefreshHttpConfig {

  /** ChatGPT 토큰 갱신 클라이언트. */
  @Bean
  ChatgptTokenClient chatgptTokenClient(
      LoginRefreshProperties props, ClientHttpRequestFactoryBuilder<?> factoryBuilder) {
    var settings =
        HttpClientSettings.defaults()
            .withConnectTimeout(props.connectTimeout())
            .withReadTimeout(props.readTimeout())
            .withRedirects(HttpRedirects.DONT_FOLLOW);
    RestClient client = RestClient.builder().requestFactory(factoryBuilder.build(settings)).build();
    return new ChatgptTokenClient(client, props.tokenUrl());
  }
}
