package com.workplace.notify.push;

import java.net.URI;
import java.net.http.HttpClient;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * RestClient 기반 PushGateway. 상태코드 해석은 PushSender 가 하므로 여기서는 전송과 코드 반환만 한다. RestClient 는 연결·응답 타임아웃
 * (workplace.push.timeout)을 건 전용 인스턴스를 내부 생성한다 — 외부 푸시 서비스 지연이 스레드를 오래 잡지 않게.
 */
@Slf4j
@Component
public class WebPushGateway implements PushGateway {

  private final RestClient client;

  @Autowired
  public WebPushGateway(PushProperties props) {
    this(buildClient(props));
  }

  /** 테스트용 — MockRestServiceServer 에 바인딩된 RestClient 주입. */
  WebPushGateway(RestClient client) {
    this.client = client;
  }

  private static RestClient buildClient(PushProperties props) {
    HttpClient http = HttpClient.newBuilder().connectTimeout(props.timeout()).build();
    JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
    factory.setReadTimeout(props.timeout());
    return RestClient.builder().requestFactory(factory).build();
  }

  @Override
  public int deliver(String endpoint, byte[] body, Map<String, String> headers) {
    try {
      return client
          .post()
          .uri(URI.create(endpoint))
          .headers(h -> headers.forEach(h::set))
          .body(body)
          .exchange((req, res) -> res.getStatusCode().value());
    } catch (RestClientException e) {
      log.debug("[push] 전송 실패 host={}: {}", URI.create(endpoint).getHost(), e.getMessage());
      return -1;
    }
  }
}
