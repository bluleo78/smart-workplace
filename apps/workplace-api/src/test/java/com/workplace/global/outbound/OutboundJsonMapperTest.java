package com.workplace.global.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

/**
 * 정적 {@code RestClient.builder()} 로 만든 외부·내부 호출 클라이언트가 응답 JSON 을 Jackson 2 로 읽는지 검증한다(WP-1588).
 *
 * <p>왜: 정적 빌더는 Boot 의 변환기 설정({@code spring.http.converters.preferred-json-mapper})을 거치지 않고
 * classpath 를 보고 JSON 라이브러리를 고른다. Boot 4 스타터가 Jackson 3(tools.jackson)을 함께 끌어오면 Jackson 3 이 먼저
 * 골라지고, 기본값이 달라 (null → 기본형 실패 등) Boot 3.5 때 잘 읽던 응답이 조용히 예외가 된다. 예: 우선순위 분류 응답 {@code
 * importanceScore: null} → {@code int}. InternalHttp·WebPushGateway·Gen:iA 로그인·토큰 갱신·사용량 조회 클라이언트가
 * 모두 같은 정적 빌더 경로다.
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
  void 정적_빌더_기본_JSON_변환기는_Jackson2_다() {
    Score s = RestClient.builder().baseUrl(baseUrl).build().get().retrieve().body(Score.class);
    assertThat(s.importanceScore()).isZero();
  }
}
