package com.workplace.notify.push;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * RestClient 기반 PushGateway. 상태코드 해석은 PushSender 가 하므로 여기서는 전송과 코드 반환만 한다. RestClient 는 연결·응답 타임아웃
 * (workplace.push.timeout)을 건 전용 인스턴스를 내부 생성한다 — 외부 푸시 서비스 지연이 스레드를 오래 잡지 않게. 리다이렉트는 따라가지 않는다(SSRF
 * 방어 — EndpointValidator 가 검증한 공인 주소가 3xx 로 내부 주소에 우회 접근하지 못하게, 3xx 는 상태코드로 그대로 반환).
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

  /** 코드베이스 표준 RestClient 구성(IssueAiConfig 등) + 리다이렉트 미추적을 명시한다 — 클라이언트 구현마다 기본값이 달라 생략하면 안 된다. */
  private static RestClient buildClient(PushProperties props) {
    var settings =
        ClientHttpRequestFactorySettings.defaults()
            .withConnectTimeout(props.timeout())
            .withReadTimeout(props.timeout())
            .withRedirects(ClientHttpRequestFactorySettings.Redirects.DONT_FOLLOW);
    var factory = ClientHttpRequestFactoryBuilder.detect().build(settings);
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
          .exchange(
              (req, res) -> {
                int status = res.getStatusCode().value();
                if (!res.getStatusCode().is2xxSuccessful()) logRejected(uri, status, res.getBody());
                return status;
              });
    } catch (RuntimeException e) {
      // 네트워크 오류·타임아웃·기타 런타임 예외를 모두 -1 로 흡수한다 — deliver 는 절대 던지지 않는다는 계약(PushGateway).
      log.warn("[push] 전송 실패 host={}: {}", uri.getHost(), e.getMessage());
      return -1;
    }
  }

  /**
   * 푸시 서비스 거부 응답 기록 — 사유가 남지 않으면 원인 파악이 어렵다(WP-152: Apple 이 VAPID sub 를 거부했지만 로그가 없어 DB 실패 횟수로 추적).
   * endpoint 경로는 구독 토큰이라 host 만 남긴다. 404/410(만료 구독 정리)은 정상 흐름이라 debug. 본문(Apple {"reason":..} 등)은
   * 200자까지.
   */
  private static void logRejected(URI uri, int status, InputStream body) {
    if (status == 404 || status == 410) {
      log.debug("[push] 만료 구독 host={} status={}", uri.getHost(), status);
      return;
    }
    String reason;
    try {
      reason = new String(body.readNBytes(200), StandardCharsets.UTF_8).strip();
    } catch (IOException e) {
      reason = "";
    }
    log.warn("[push] 발송 거부 host={} status={} reason={}", uri.getHost(), status, reason);
  }
}
