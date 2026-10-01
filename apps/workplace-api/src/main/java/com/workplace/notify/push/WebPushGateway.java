package com.workplace.notify.push;

import com.workplace.global.util.Texts;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.http.client.ClientHttpRequestFactoryBuilder;
import org.springframework.boot.http.client.ClientHttpRequestFactorySettings;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * RestClient 기반 PushGateway. 상태코드 해석은 PushSender 가 하므로 여기서는 전송과 코드 반환만 한다. RestClient 는 연결·응답 타임아웃
 * (workplace.push.timeout)을 건 전용 인스턴스를 내부 생성한다 — 외부 푸시 서비스 지연이 스레드를 오래 잡지 않게. 리다이렉트는 따라가지 않는다(SSRF
 * 방어 — EndpointValidator 가 검증한 공인 주소가 3xx 로 내부 주소에 우회 접근하지 못하게, 3xx 는 상태코드로 그대로 반환).
 */
@Component
public class WebPushGateway implements PushGateway {

  private static final int REASON_MAX_BYTES = 512;
  private static final int REASON_MAX_CHARS = 200;

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
  public Result deliver(String endpoint, byte[] body, Map<String, String> headers) {
    // endpoint 파싱 자체가 실패할 수 있다(잘못된 URI 문자열) — URI.create 는 IllegalArgumentException 을 던지므로 전송 예외와
    // 별도로 처리한다.
    URI uri;
    try {
      uri = URI.create(endpoint);
    } catch (RuntimeException e) {
      return new Result(-1, "endpoint 파싱 실패");
    }
    try {
      return client
          .post()
          .uri(uri)
          .headers(h -> headers.forEach(h::set))
          .body(body)
          .exchange(
              (req, res) -> {
                HttpStatusCode status = res.getStatusCode();
                return status.is2xxSuccessful()
                    ? Result.of(status.value())
                    : new Result(status.value(), readReason(res.getBody()));
              });
    } catch (RuntimeException e) {
      // 네트워크 오류·타임아웃·기타 런타임 예외를 모두 -1 로 흡수한다 — deliver 는 절대 던지지 않는다는 계약(PushGateway).
      // e.getMessage() 는 RestClient 가 전체 URL(=구독 토큰)을 넣으므로 쓰지 않고 근본 원인만 담는다.
      Throwable cause = NestedExceptionUtils.getMostSpecificCause(e);
      String detail = cause == e ? "" : Objects.toString(cause.getMessage(), "");
      return new Result(-1, (cause.getClass().getSimpleName() + " " + detail).strip());
    }
  }

  /** 거부 응답 본문 앞부분(Apple {"reason":..} 등) — 큰 본문을 다 읽지 않도록 상한까지만 읽는다. */
  private static String readReason(InputStream body) {
    try {
      // 원격 본문이 그대로 로그에 들어가므로 개행·제어문자를 공백으로 바꿔 한 줄로 만든다(HTML 에러 페이지·로그 줄 주입 방지).
      String raw = new String(body.readNBytes(REASON_MAX_BYTES), StandardCharsets.UTF_8);
      return Texts.truncateCodePoints(raw.replaceAll("\\p{Cntrl}+", " ").strip(), REASON_MAX_CHARS);
    } catch (IOException e) {
      return "";
    }
  }
}
