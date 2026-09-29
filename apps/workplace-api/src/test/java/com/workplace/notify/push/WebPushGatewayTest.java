package com.workplace.notify.push;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;

import java.io.IOException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** WebPushGateway — 헤더·본문 전달과 상태코드 그대로 반환(4xx/5xx 도 예외 없이), 예외 상황은 -1. */
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

  @Test
  void deliver_returnsMinusOne_onMalformedEndpoint() {
    WebPushGateway gw = new WebPushGateway(RestClient.builder().build());

    int status = gw.deliver("not a url", new byte[] {1}, Map.of());

    assertThat(status).isEqualTo(-1);
  }
}
