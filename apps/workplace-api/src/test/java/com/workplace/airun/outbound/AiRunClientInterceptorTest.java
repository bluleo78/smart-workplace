package com.workplace.airun.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import com.sun.net.httpserver.HttpServer;
import com.workplace.airun.context.AiRunHeader;
import com.workplace.airun.dto.AiRunRecord;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.json.JsonMappers;
import com.workplace.global.outbound.InternalHttp;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/** AiRunClientInterceptor — 실제 소켓으로 헤더 부착과 닿기 전 실패 기록을 검증한다 (WP-1829). */
class AiRunClientInterceptorTest {

  private HttpServer server;
  private String baseUrl;
  private int status = 200;
  private long sleepMs = 0;
  private final AtomicReference<String> seenHeader = new AtomicReference<>();
  private AiRunRecorder recorder;

  @BeforeEach
  void setUp() throws Exception {
    recorder = mock(AiRunRecorder.class);
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/",
        ex -> {
          ex.getRequestBody().readAllBytes();
          seenHeader.set(ex.getRequestHeaders().getFirst(AiRunHeader.NAME));
          if (sleepMs > 0) {
            try {
              Thread.sleep(sleepMs);
            } catch (InterruptedException ignored) {
              Thread.currentThread().interrupt();
            }
          }
          byte[] b = "{}".getBytes(StandardCharsets.UTF_8);
          ex.getResponseHeaders().add("Content-Type", "application/json");
          try {
            ex.sendResponseHeaders(status, b.length);
            ex.getResponseBody().write(b);
          } catch (java.io.IOException ignored) {
            // 클라이언트가 먼저 끊은 경우(시간 초과 테스트)
          } finally {
            ex.close();
          }
        });
    server.start();
    baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @AfterEach
  void tearDown() {
    server.stop(0);
  }

  private RestClient client(String base, Duration read) {
    return InternalHttp.restClient(base, Duration.ofSeconds(1), read)
        .requestInterceptor(new AiRunClientInterceptor(recorder))
        .build();
  }

  private void post(RestClient c, String path) {
    c.post().uri(path).body(Map.of("a", 1)).retrieve().toBodilessEntity();
  }

  @SuppressWarnings("unchecked")
  private Map<String, Object> decode(String header) {
    byte[] json = Base64.getUrlDecoder().decode(header);
    return JsonMappers.JACKSON2.readValue(new String(json, StandardCharsets.UTF_8), Map.class);
  }

  private AiRunRecord captured() {
    ArgumentCaptor<AiRunRecord> cap = ArgumentCaptor.forClass(AiRunRecord.class);
    verify(recorder, times(1)).upsert(cap.capture());
    return cap.getValue();
  }

  @Test
  void _200이면_헤더를_싣고_기록하지_않는다() {
    post(client(baseUrl, Duration.ofSeconds(1)), "/mail/classify-batch");

    assertThat(decode(seenHeader.get())).containsEntry("kind", "MAIL_CLASSIFY_BATCH");
    verify(recorder, never()).upsert(any());
  }

  @Test
  void _503이면_예외는_그대로이고_FAILED_http_503_을_기록한다() {
    status = 503;
    assertThatThrownBy(() -> post(client(baseUrl, Duration.ofSeconds(1)), "/mail/classify-batch"))
        .isInstanceOf(HttpServerErrorException.ServiceUnavailable.class);

    AiRunRecord r = captured();
    assertThat(r.status()).isEqualTo("FAILED");
    assertThat(r.errorReason()).isNull();
    assertThat(r.errorDetail()).isEqualTo("http_503");
    assertThat(r.kind()).isEqualTo("MAIL_CLASSIFY_BATCH");
    assertThat(r.runId().toString()).isEqualTo(decode(seenHeader.get()).get("runId"));
  }

  @Test
  void _400이면_기록하지_않는다() {
    status = 400;
    assertThatThrownBy(() -> post(client(baseUrl, Duration.ofSeconds(1)), "/mail/classify-batch"))
        .isInstanceOf(org.springframework.web.client.HttpClientErrorException.class);
    verify(recorder, never()).upsert(any());
  }

  @Test
  void 연결_거부면_agent_unreachable_을_기록한다() throws Exception {
    int closed;
    try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      closed = s.getLocalPort();
    }
    assertThatThrownBy(
            () ->
                post(
                    client("http://127.0.0.1:" + closed, Duration.ofSeconds(1)),
                    "/mail/classify-batch"))
        .isInstanceOf(ResourceAccessException.class);

    assertThat(captured().errorReason()).isEqualTo("agent_unreachable");
  }

  @Test
  void 읽기_시간_초과면_agent_timeout_을_기록한다() {
    sleepMs = 2000;
    assertThatThrownBy(() -> post(client(baseUrl, Duration.ofSeconds(1)), "/mail/classify-batch"))
        .isInstanceOf(ResourceAccessException.class);

    assertThat(captured().errorReason()).isEqualTo("agent_timeout");
  }

  @Test
  void 기록기가_던져도_호출자가_받는_예외는_같다() throws Exception {
    org.mockito.Mockito.doThrow(new RuntimeException("boom")).when(recorder).upsert(any());

    status = 503;
    assertThatThrownBy(() -> post(client(baseUrl, Duration.ofSeconds(1)), "/mail/classify-batch"))
        .isInstanceOf(HttpServerErrorException.ServiceUnavailable.class);

    int closed;
    try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
      closed = s.getLocalPort();
    }
    assertThatThrownBy(
            () ->
                post(
                    client("http://127.0.0.1:" + closed, Duration.ofSeconds(1)),
                    "/mail/classify-batch"))
        .isInstanceOf(ResourceAccessException.class);
  }

  @Test
  void 표에_없는_경로는_kind_없이_보내고_기록하지_않는다() {
    status = 503;
    assertThatThrownBy(() -> post(client(baseUrl, Duration.ofSeconds(1)), "/models"))
        .isInstanceOf(HttpServerErrorException.ServiceUnavailable.class);

    assertThat(decode(seenHeader.get())).doesNotContainKey("kind");
    verify(recorder, never()).upsert(any());
  }

  /** 인터럽트(취소)로 끊긴 호출은 기록하지 않고 예외를 그대로 던진다. */
  @Test
  void 인터럽트는_기록하지_않고_그대로_던진다() {
    var interceptor = new AiRunClientInterceptor(recorder);
    var request =
        new org.springframework.http.client.support.HttpRequestWrapper(
            new org.springframework.mock.http.client.MockClientHttpRequest(
                org.springframework.http.HttpMethod.POST,
                java.net.URI.create("http://x/mail/classify-batch")));
    java.io.IOException wrapped =
        new java.io.IOException("Request was interrupted", new InterruptedException());
    assertThatThrownBy(
            () ->
                interceptor.intercept(
                    request,
                    new byte[0],
                    (r, b) -> {
                      throw wrapped;
                    }))
        .isSameAs(wrapped);
    verify(recorder, never()).upsert(any());
  }

  /** AiAgentHttp 는 본문 버퍼링을 끄고도 헤더 부착·5xx 기록이 그대로 동작한다. */
  @Test
  void AiAgentHttp_버퍼링_없이도_헤더와_기록이_동작한다() {
    status = 503;
    RestClient c =
        new AiAgentHttp(recorder)
            .restClient(baseUrl, Duration.ofSeconds(1), Duration.ofSeconds(1))
            .build();
    assertThatThrownBy(() -> post(c, "/mail/classify-batch"))
        .isInstanceOf(HttpServerErrorException.ServiceUnavailable.class);

    assertThat(decode(seenHeader.get())).containsEntry("kind", "MAIL_CLASSIFY_BATCH");
    assertThat(captured().errorDetail()).isEqualTo("http_503");
  }
}
