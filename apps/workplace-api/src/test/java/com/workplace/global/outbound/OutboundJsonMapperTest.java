package com.workplace.global.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 정적 아웃바운드 클라이언트가 응답 JSON 을 Jackson 2 로 읽는지 검증한다(WP-1588·WP-1608) — 왜 고정이 필요한지는 {@link
 * OutboundJson} 참조. 예: 우선순위 분류 응답 {@code importanceScore: null} → {@code int} 가 Jackson 3 기본값이면 예외가
 * 된다.
 */
class OutboundJsonMapperTest {

  /** 기본형 필드를 가진 응답 — Jackson 2 기본은 null 을 0 으로 읽고, Jackson 3 기본은 실패한다. */
  record Score(int importanceScore) {}

  private HttpServer server;
  private String baseUrl;

  @BeforeEach
  void setUp() throws IOException {
    // 루프백 임의 포트에 null 이 든 JSON 을 돌려주는 서버를 띄운다.
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/",
        ex -> {
          byte[] bytes = "{\"importanceScore\":null}".getBytes(StandardCharsets.UTF_8);
          ex.getResponseHeaders().add("Content-Type", "application/json");
          ex.sendResponseHeaders(200, bytes.length);
          try (var out = ex.getResponseBody()) {
            out.write(bytes);
          }
        });
    server.start();
    baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @AfterEach
  void tearDown() {
    server.stop(0);
  }

  @Test
  void 내부_클라이언트는_null_을_기본형_0_으로_읽는다() {
    Score s = InternalHttp.restClient(baseUrl).build().get().uri("/").retrieve().body(Score.class);
    assertThat(s.importanceScore()).isZero();
  }

  @Test
  void OutboundJson_빌더는_null_을_기본형_0_으로_읽는다() {
    Score s =
        OutboundJson.restClientBuilder()
            .baseUrl(baseUrl)
            .build()
            .get()
            .retrieve()
            .body(Score.class);
    assertThat(s.importanceScore()).isZero();
  }

  /**
   * 전제: 감싸지 않은 정적 빌더는 Jackson 3 기본값으로 {@code null → int} 를 실패한다. 의존성 변경 뒤 이 테스트가 깨지면(= 평범한 빌더도
   * 성공하면) OutboundJson 이 아직 필요한지 재검토한다(WP-1609).
   */
  @Test
  void 평범한_정적_빌더는_null_을_기본형으로_읽지_못한다() {
    assertThatThrownBy(
            () -> RestClient.builder().baseUrl(baseUrl).build().get().retrieve().body(Score.class))
        .isInstanceOf(RestClientException.class);
  }
}
