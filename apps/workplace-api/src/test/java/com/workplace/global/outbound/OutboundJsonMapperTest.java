package com.workplace.global.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpServer;
import com.workplace.global.json.JsonMappers;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.MapperFeature;

/**
 * 정적 아웃바운드 클라이언트가 응답 JSON 을 Jackson 2 때와 같은 기본값으로 읽는지 검증한다(WP-1588·WP-1608·WP-1609) — 왜 고정이 필요한지는
 * {@link OutboundJson} 참조. 예: 우선순위 분류 응답 {@code importanceScore: null} → {@code int} 가 Jackson 3
 * 기본값이면 예외가 된다. 앱이 Jackson 3 만 쓰게 된 뒤(WP-1609)에도 정적 빌더는 Jackson 3 기본값이라 고정이 여전히 필요하다.
 */
class OutboundJsonMapperTest {

  /** 기본형 필드를 가진 응답 — Jackson 2 기본은 null 을 0 으로 읽고, Jackson 3 기본은 실패한다. */
  record Score(int importanceScore) {}

  /** 응답에 있는 속성 일부만 받는 DTO — 외부 응답에 모르는 속성이 늘어도 읽혀야 한다. */
  record Empty() {}

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
   * WP-1609 전 변환기({@code new MappingJackson2HttpMessageConverter()})처럼 모르는 속성은 무시한다 — Jackson 2
   * 기본값만 쓰면 실패하므로 OutboundJson 이 따로 끈다.
   */
  @Test
  void OutboundJson_빌더는_모르는_속성을_무시한다() {
    Empty e =
        OutboundJson.restClientBuilder()
            .baseUrl(baseUrl)
            .build()
            .get()
            .retrieve()
            .body(Empty.class);
    assertThat(e).isNotNull();
  }

  /**
   * {@code @JsonCreator} 없이 공개 전체 인자 생성자만 있는 일반 클래스(레코드 아님) — 생성자 인자 이름으로만 읽을 수 있다(암묵 생성자는 공개여야
   * 쓰인다).
   */
  public static final class Plain {
    final int importanceScore;
    final String label;

    public Plain(int importanceScore, String label) {
      this.importanceScore = importanceScore;
      this.label = label;
    }
  }

  /**
   * WP-1609 전 변환기는 {@code Jackson2ObjectMapperBuilder} 가 ParameterNamesModule 을 등록해 이런 클래스를 생성자 인자
   * 이름으로 읽었다. Jackson 2 기본값({@code configureForJackson2})은 DETECT_PARAMETER_NAMES 를 끄므로
   * OutboundJson 이 다시 켠다.
   */
  @Test
  void OutboundJson_빌더는_생성자_인자_이름으로_일반_클래스를_읽는다() {
    server.createContext(
        "/plain",
        ex -> {
          byte[] bytes =
              "{\"importanceScore\":7,\"label\":\"high\"}".getBytes(StandardCharsets.UTF_8);
          ex.getResponseHeaders().add("Content-Type", "application/json");
          ex.sendResponseHeaders(200, bytes.length);
          try (var out = ex.getResponseBody()) {
            out.write(bytes);
          }
        });

    Plain p =
        OutboundJson.restClientBuilder()
            .baseUrl(baseUrl)
            .build()
            .get()
            .uri("/plain")
            .retrieve()
            .body(Plain.class);

    assertThat(p.importanceScore).isEqualTo(7);
    assertThat(p.label).isEqualTo("high");
  }

  /**
   * WP-1609 전 변환기({@code Jackson2ObjectMapperBuilder})처럼 DEFAULT_VIEW_INCLUSION 은 끄고
   * DETECT_PARAMETER_NAMES 는 켠다 — 뷰를 지정해 쓰면 {@code @JsonView} 없는 속성이 빠지는 동작까지 같게 둔다.
   */
  @Test
  void OutboundJson_매퍼는_옛_변환기의_매퍼_기능_설정과_같다() {
    assertThat(OutboundJson.MAPPER.isEnabled(MapperFeature.DEFAULT_VIEW_INCLUSION)).isFalse();
    assertThat(OutboundJson.MAPPER.isEnabled(MapperFeature.DETECT_PARAMETER_NAMES)).isTrue();
    assertThat(OutboundJson.MAPPER.isEnabled(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES))
        .isFalse();
    // 크기 한도는 공유 빌더(JsonMappers)의 Jackson 2 값을 그대로 쓴다.
    assertThat(
            OutboundJson.MAPPER.tokenStreamFactory().streamReadConstraints().getMaxNestingDepth())
        .isEqualTo(JsonMappers.MAX_READ_NESTING_DEPTH);
  }

  /**
   * 전제: 감싸지 않은 정적 빌더는 Jackson 3 기본값으로 {@code null → int} 를 실패한다(Jackson 3 만 남은 WP-1609 뒤에도 그대로다).
   * 의존성 변경 뒤 이 테스트가 깨지면(= 평범한 빌더도 성공하면) OutboundJson 이 아직 필요한지 재검토한다.
   */
  @Test
  void 평범한_정적_빌더는_null_을_기본형으로_읽지_못한다() {
    assertThatThrownBy(
            () -> RestClient.builder().baseUrl(baseUrl).build().get().retrieve().body(Score.class))
        .isInstanceOf(RestClientException.class);
  }
}
