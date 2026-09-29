package com.workplace.notify.push;

import java.net.URI;
import java.net.http.HttpClient;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

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
    // endpoint 파싱 자체가 실패할 수 있다(잘못된 URI 문자열) — URI.create 는 IllegalArgumentException 을 던지므로
    // 전송 예외와 별도로 먼저 처리하고, 이후 로그에서 재파싱하지 않도록 파싱된 값을 재사용한다.
    URI uri;
    try {
      uri = URI.create(endpoint);
    } catch (RuntimeException e) {
      log.debug("[push] endpoint 파싱 실패: {}", e.getMessage());
      return -1;
    }
    try {
      return client
          .post()
          .uri(uri)
          .headers(h -> headers.forEach(h::set))
          .body(body)
          .exchange((req, res) -> res.getStatusCode().value());
    } catch (RuntimeException e) {
      // 네트워크 오류·타임아웃·기타 런타임 예외를 모두 -1 로 흡수한다 — deliver 는 절대 던지지 않는다는 계약(PushGateway).
      log.debug("[push] 전송 실패 host={}: {}", uri.getHost(), e.getMessage());
      return -1;
    }
  }
}
