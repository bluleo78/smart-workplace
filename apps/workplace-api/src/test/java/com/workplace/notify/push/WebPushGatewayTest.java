package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** WebPushGateway — 헤더·본문 전달과 상태코드 그대로 반환(4xx/5xx 도 예외 없이), 예외 상황은 -1. 실패 사유는 구독 토큰 없이 돌려준다. */
class WebPushGatewayTest {

  MockRestServiceServer server;
  WebPushGateway gw;

  /** MockRestServiceServer 에 바인딩한 클라이언트로 게이트웨이를 만든다(리다이렉트 테스트만 실제 생성자 사용). */
  @BeforeEach
  void setUp() {
    RestClient.Builder b = RestClient.builder();
    server = MockRestServiceServer.bindTo(b).build();
    gw = new WebPushGateway(b.build());
  }

  @Test
  void deliver_passesHeaders_andReturnsStatus() {
    server
        .expect(requestTo("https://push.example.com/sub/1"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("TTL", "60"))
        .andExpect(header("Content-Encoding", "aes128gcm"))
        .andRespond(withStatus(HttpStatus.CREATED));
    server
        .expect(requestTo("https://push.example.com/sub/2"))
        .andRespond(withStatus(HttpStatus.GONE));

    PushGateway.Result ok =
        gw.deliver(
            "https://push.example.com/sub/1",
            new byte[] {1, 2},
            Map.of("TTL", "60", "Content-Encoding", "aes128gcm"));
    PushGateway.Result gone =
        gw.deliver("https://push.example.com/sub/2", new byte[] {1}, Map.of());

    assertThat(ok).isEqualTo(PushGateway.Result.of(201));
    assertThat(gone.status()).isEqualTo(410);
    server.verify();
  }

  @Test
  void deliver_returnsMinusOne_onIoFailure() {
    server
        .expect(requestTo("https://push.example.com/sub/3"))
        .andRespond(withException(new IOException("connection reset")));

    PushGateway.Result r = gw.deliver("https://push.example.com/sub/3", new byte[] {1}, Map.of());

    assertThat(r.status()).isEqualTo(-1);
  }

  /** 거부 응답(WP-152: Apple 403 BadJwtToken)은 응답 본문을 사유로 돌려준다. */
  @Test
  void deliver_returnsRejectionReason() {
    server
        .expect(requestTo("https://web.push.apple.com/secret-token"))
        .andRespond(
            withStatus(HttpStatus.FORBIDDEN)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"reason\":\"BadJwtToken\"}"));

    PushGateway.Result r =
        gw.deliver("https://web.push.apple.com/secret-token", new byte[] {1}, Map.of());

    assertThat(r).isEqualTo(new PushGateway.Result(403, "{\"reason\":\"BadJwtToken\"}"));
  }

  /** 원격 본문(HTML 에러 페이지 등)의 개행·제어문자는 한 줄로 접는다 — 로그 줄 분리·주입 방지. */
  @Test
  void deliver_rejectionReason_isSingleLine() {
    server
        .expect(requestTo("https://push.example.com/sub/5"))
        .andRespond(
            withStatus(HttpStatus.BAD_GATEWAY)
                .body("<html>\r\n<h1>502</h1>\n\tBad\u0000Gateway</html>"));

    PushGateway.Result r = gw.deliver("https://push.example.com/sub/5", new byte[] {1}, Map.of());

    assertThat(r.reason()).isEqualTo("<html> <h1>502</h1> Bad Gateway</html>");
  }

  /** 네트워크 오류 사유는 근본 원인만 — RestClient 예외 메시지에 든 전체 URL(구독 토큰)은 담지 않는다. */
  @Test
  void deliver_networkFailureReason_excludesEndpointPath() {
    server
        .expect(requestTo("https://push.example.com/sub/4"))
        .andRespond(withException(new IOException("connection reset")));

    PushGateway.Result r = gw.deliver("https://push.example.com/sub/4", new byte[] {1}, Map.of());

    assertThat(r.status()).isEqualTo(-1);
    assertThat(r.reason()).isEqualTo("IOException connection reset").doesNotContain("/sub/4");
  }

  @Test
  void deliver_returnsMinusOne_onMalformedEndpoint() {
    PushGateway.Result r = gw.deliver("not a url", new byte[] {1}, Map.of());

    assertThat(r.status()).isEqualTo(-1);
  }

  /**
   * SSRF 방어 — 실제(운영) 생성자로 만든 클라이언트는 3xx 를 따라가지 않고 상태코드로 반환해야 한다. MockRestServiceServer 는 요청 팩토리를
   * 대체하므로 리다이렉트 동작을 검증할 수 없어, 로컬 HTTP 서버로 302 → 다른 경로를 실제로 응답시킨다.
   */
  @Test
  void deliver_doesNotFollowRedirects() throws IOException {
    HttpServer server =
        HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    AtomicInteger targetHits = new AtomicInteger();
    server.createContext(
        "/redirect",
        ex -> {
          ex.getRequestBody().readAllBytes();
          ex.getResponseHeaders().add("Location", "/target");
          ex.sendResponseHeaders(302, -1);
          ex.close();
        });
    server.createContext(
        "/target",
        ex -> {
          targetHits.incrementAndGet();
          ex.sendResponseHeaders(200, -1);
          ex.close();
        });
    server.start();
    try {
      WebPushGateway real =
          new WebPushGateway(
              new PushProperties(true, true, null, Duration.ofSeconds(2), null, null));
      String ep = "http://127.0.0.1:" + server.getAddress().getPort() + "/redirect";

      PushGateway.Result r = real.deliver(ep, new byte[] {1}, Map.of("TTL", "60"));

      assertThat(r.status()).isEqualTo(302);
      assertThat(targetHits).hasValue(0);
    } finally {
      server.stop(0);
    }
  }
}
