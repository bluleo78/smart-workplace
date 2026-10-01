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
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** WebPushGateway — 헤더·본문 전달과 상태코드 그대로 반환(4xx/5xx 도 예외 없이), 예외 상황은 -1. 거부·실패는 사유를 로그로 남긴다. */
@ExtendWith(OutputCaptureExtension.class)
class WebPushGatewayTest {

  @Test
  void deliver_passesHeaders_andReturnsStatus() {
    RestClient.Builder b = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
    WebPushGateway gw = new WebPushGateway(b.build());
    server
        .expect(requestTo("https://push.example.com/sub/1"))
        .andExpect(method(HttpMethod.POST))
        .andExpect(header("TTL", "60"))
        .andExpect(header("Content-Encoding", "aes128gcm"))
        .andRespond(withStatus(HttpStatus.CREATED));
    server
        .expect(requestTo("https://push.example.com/sub/2"))
        .andRespond(withStatus(HttpStatus.GONE));

    int ok =
        gw.deliver(
            "https://push.example.com/sub/1",
            new byte[] {1, 2},
            Map.of("TTL", "60", "Content-Encoding", "aes128gcm"));
    int gone = gw.deliver("https://push.example.com/sub/2", new byte[] {1}, Map.of());

    assertThat(ok).isEqualTo(201);
    assertThat(gone).isEqualTo(410);
    server.verify();
  }

  @Test
  void deliver_returnsMinusOne_onIoFailure() {
    RestClient.Builder b = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
    WebPushGateway gw = new WebPushGateway(b.build());
    server
        .expect(requestTo("https://push.example.com/sub/3"))
        .andRespond(withException(new IOException("connection reset")));

    int status = gw.deliver("https://push.example.com/sub/3", new byte[] {1}, Map.of());

    assertThat(status).isEqualTo(-1);
  }

  /**
   * 거부 응답(WP-152: Apple 403 BadJwtToken)은 status·host·사유를 warn 으로 남긴다. endpoint 경로(구독 토큰)는 로그에 남기지
   * 않는다.
   */
  @Test
  void deliver_logsRejectionReason_withoutEndpointPath(CapturedOutput output) {
    RestClient.Builder b = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
    WebPushGateway gw = new WebPushGateway(b.build());
    server
        .expect(requestTo("https://web.push.apple.com/secret-token"))
        .andRespond(
            withStatus(HttpStatus.FORBIDDEN)
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"reason\":\"BadJwtToken\"}"));

    int status = gw.deliver("https://web.push.apple.com/secret-token", new byte[] {1}, Map.of());

    assertThat(status).isEqualTo(403);
    assertThat(output)
        .contains("[push] 발송 거부 host=web.push.apple.com status=403")
        .contains("BadJwtToken")
        .doesNotContain("secret-token");
  }

  /** 만료 구독(410)은 정리 대상인 정상 흐름이라 warn 으로 남기지 않는다. */
  @Test
  void deliver_doesNotWarnOnGone(CapturedOutput output) {
    RestClient.Builder b = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
    WebPushGateway gw = new WebPushGateway(b.build());
    server
        .expect(requestTo("https://push.example.com/sub/9"))
        .andRespond(withStatus(HttpStatus.GONE));

    gw.deliver("https://push.example.com/sub/9", new byte[] {1}, Map.of());

    assertThat(output).doesNotContain("발송 거부");
  }

  @Test
  void deliver_logsNetworkFailure(CapturedOutput output) {
    RestClient.Builder b = RestClient.builder();
    MockRestServiceServer server = MockRestServiceServer.bindTo(b).build();
    WebPushGateway gw = new WebPushGateway(b.build());
    server
        .expect(requestTo("https://push.example.com/sub/4"))
        .andRespond(withException(new IOException("connection reset")));

    gw.deliver("https://push.example.com/sub/4", new byte[] {1}, Map.of());

    assertThat(output)
        .contains("[push] 전송 실패 host=push.example.com")
        .contains("connection reset")
        .doesNotContain("/sub/4");
  }

  @Test
  void deliver_returnsMinusOne_onMalformedEndpoint() {
    WebPushGateway gw = new WebPushGateway(RestClient.builder().build());

    int status = gw.deliver("not a url", new byte[] {1}, Map.of());

    assertThat(status).isEqualTo(-1);
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
      WebPushGateway gw =
          new WebPushGateway(
              new PushProperties(true, true, null, Duration.ofSeconds(2), null, null));
      String ep = "http://127.0.0.1:" + server.getAddress().getPort() + "/redirect";

      int status = gw.deliver(ep, new byte[] {1}, Map.of("TTL", "60"));

      assertThat(status).isEqualTo(302);
      assertThat(targetHits).hasValue(0);
    } finally {
      server.stop(0);
    }
  }
}
