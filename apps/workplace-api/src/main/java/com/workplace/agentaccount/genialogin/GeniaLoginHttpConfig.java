package com.workplace.agentaccount.genialogin;

import java.nio.file.Path;
import java.security.KeyStore;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.HttpClientSettings;
import org.springframework.boot.http.client.HttpRedirects;
import org.springframework.boot.ssl.SslBundle;
import org.springframework.boot.ssl.SslStoreBundle;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.client.RestClient;

/**
 * Gen:iA 로그인 클라이언트 빈 구성(WP-1461). 외부 HTTPS RestClient 라 타임아웃을 설정에서 받고 리다이렉트는 따라가지 않는다(검증기·state 가 든
 * 요청이 다른 주소로 새지 않게). caCertFile 이 있으면 기본 신뢰에 사설 CA 를 더한 SSL 번들을 쓴다. RestClient 는 빈으로 노출하지 않는다.
 */
@Configuration
public class GeniaLoginHttpConfig {

  /** Gen:iA 로그인 서버 클라이언트. */
  @Bean
  GeniaLoginClient geniaLoginClient(
      GeniaLoginProperties props, ClientHttpRequestFactoryBuilder<?> factoryBuilder) {
    var settings =
        HttpClientSettings.defaults()
            .withConnectTimeout(props.connectTimeout())
            .withReadTimeout(props.readTimeout())
            .withRedirects(HttpRedirects.DONT_FOLLOW);
    if (props.caCertFile() != null) {
      KeyStore trust = GeniaTrustStores.withExtraCa(Path.of(props.caCertFile()));
      settings = settings.withSslBundle(SslBundle.of(SslStoreBundle.of(null, null, trust)));
    }
    RestClient client = RestClient.builder().requestFactory(factoryBuilder.build(settings)).build();
    return new GeniaLoginClient(client, props.serverUrl(), props.client());
  }
}
