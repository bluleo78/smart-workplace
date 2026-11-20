package com.workplace.wiki.outbound;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import com.sun.net.httpserver.HttpServer;
import com.workplace.airun.service.AiRunRecorder;
import com.workplace.global.outbound.AiAgentProperties;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 로컬 HttpServer 스텁으로 SSE 를 실제 소켓에 흘려보내고, JDK HttpClient(ofLines) 가 라인 단위로 점진 소비하는지 검증한다 — webflux
 * 없이 실제 HTTP 스트리밍이 동작함을 증명.
 */
class WikiAiAgentStreamClientTest {

  private HttpServer server;
  private WikiAiAgentStreamClient client;
  private final AiRunRecorder recorder = mock(AiRunRecorder.class);

  @BeforeEach
  void start() throws Exception {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
  }

  @AfterEach
  void stop() {
    if (server != null) {
      server.stop(0);
    }
  }

  /** 스텁을 기동하고 baseUrl 을 가리키는 client 를 만든다. */
  private void boot(String sseBody, int status) {
    server.createContext(
        "/wiki/compose",
        exchange -> {
          byte[] payload = sseBody.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          // status, 0 → chunked transfer-encoding(점진 전달).
          exchange.sendResponseHeaders(status, 0);
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(payload);
            os.flush();
          }
        });
    server.start();
    int port = server.getAddress().getPort();
    AiAgentProperties props =
        new AiAgentProperties("http://127.0.0.1:" + port, "changeme-local", true);
    client = new WikiAiAgentStreamClient(props, HttpClient.newHttpClient(), recorder);
  }

  @Test
  void stream_deliversDeltasInOrder_thenDone() throws Exception {
    // 실측 에이전트 SSE 모양: event: delta\ndata:{"text":"a"}\n\n ... event: done
    String body =
        "event: delta\ndata: {\"text\":\"a\"}\n\n"
            + "event: delta\ndata: {\"text\":\"b\"}\n\n"
            + "event: delta\ndata: {\"text\":\"c\"}\n\n"
            + "event: done\ndata: {}\n\n";
    boot(body, 200);

    List<String> deltas = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    client.stream("{}", deltas::add, () -> done.set(true));

    assertThat(deltas).containsExactly("a", "b", "c");
    assertThat(done).isTrue();
  }

  /**
   * 점진 전달(스트리밍) 증명 — 서버가 delta1 만 flush 한 뒤 latch 에 블록되고, 그 latch 는 client 의 onDelta("a") 가 풀어준다.
   * 만약 ofLines() 가 전체 본문을 버퍼링한 뒤 파싱한다면 onDelta("a") 가 영영 안 불려 latch 가 안 풀리고 delta2/done 이 도착하지 않아
   * 단언이 실패한다 → 라인 단위 lazy 소비가 실제로 일어남을 보장(webflux 없이). CP2 의 결정적 대체.
   */
  @Test
  void stream_isTrulyIncremental_notBufferedThenParsed() throws Exception {
    CountDownLatch firstSeen = new CountDownLatch(1);
    // 서버 핸들러에서 관측한 "latch 가 풀렸는가" 를 테스트 스레드로 빼낸다.
    AtomicBoolean latchReleased = new AtomicBoolean(false);
    server.createContext(
        "/wiki/compose",
        exchange -> {
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(200, 0); // chunked
          OutputStream os = exchange.getResponseBody();
          os.write("event: delta\ndata: {\"text\":\"a\"}\n\n".getBytes(StandardCharsets.UTF_8));
          os.flush();
          try {
            // client 가 "a" 를 소비해야만 latch 가 풀린다. 버퍼링이면 풀리지 않아 await 가 false 를 반환.
            latchReleased.set(firstSeen.await(5, TimeUnit.SECONDS));
          } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
          }
          os.write(
              "event: delta\ndata: {\"text\":\"b\"}\n\nevent: done\ndata: {}\n\n"
                  .getBytes(StandardCharsets.UTF_8));
          os.flush();
          os.close();
        });
    server.start();
    int port = server.getAddress().getPort();
    AiAgentProperties props =
        new AiAgentProperties("http://127.0.0.1:" + port, "changeme-local", true);
    client = new WikiAiAgentStreamClient(props, HttpClient.newHttpClient(), recorder);

    List<String> deltas = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    client.stream(
        "{}",
        t -> {
          if (t.equals("a")) {
            firstSeen.countDown(); // 첫 토큰 소비 → 서버 진행 허용
          }
          deltas.add(t);
        },
        () -> done.set(true));

    // 점진 전달 증명의 핵심 단언: latch 가 실제로 풀렸어야 한다(=본문 끝나기 전에 "a" 를 소비).
    // 만약 ofLines() 가 전체 본문을 버퍼링했다면 latch 는 5s 안에 풀리지 않아 false → 테스트 실패.
    assertThat(latchReleased).isTrue();
    assertThat(deltas).containsExactly("a", "b");
    assertThat(done).isTrue();
  }

  @Test
  void stream_errorEvent_throws() {
    String body = "event: error\ndata: {\"message\":\"boom\"}\n\n";
    boot(body, 200);
    assertThatThrownBy(() -> client.stream("{}", t -> {}, () -> {})).hasMessageContaining("error");
  }

  @Test
  void stream_non200_throws() {
    boot("{\"error\":\"invalid_payload\"}", 400);
    assertThatThrownBy(() -> client.stream("{}", t -> {}, () -> {})).hasMessageContaining("400");
  }

  // ---- WP-1829: X-AI-Run 헤더와 호출 전 실패 기록 ----

  /** 서버가 받은 X-AI-Run 헤더를 디코드한 JSON 필드. */
  private final java.util.concurrent.atomic.AtomicReference<String> seenAiRun =
      new java.util.concurrent.atomic.AtomicReference<>();

  /** 헤더를 캡처하는 스텁을 기동해 client 를 만든다. */
  private void bootCapturing(String body, int status) {
    server.createContext(
        "/wiki/compose",
        exchange -> {
          exchange.getRequestBody().readAllBytes();
          seenAiRun.set(
              exchange.getRequestHeaders().getFirst(com.workplace.airun.context.AiRunHeader.NAME));
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(status, 0);
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(body.getBytes(StandardCharsets.UTF_8));
          }
        });
    server.start();
    AiAgentProperties props =
        new AiAgentProperties(
            "http://127.0.0.1:" + server.getAddress().getPort(), "changeme-local", true);
    client = new WikiAiAgentStreamClient(props, HttpClient.newHttpClient(), recorder);
  }

  private void callClient() throws Exception {
    client.stream("{}", t -> {}, () -> {});
  }

  @Test
  void aiRun_정상_스트림은_kind_헤더를_싣고_기록하지_않는다() throws Exception {
    bootCapturing("event: delta\ndata: {\"text\":\"a\"}\n\nevent: done\ndata: {}\n\n", 200);
    callClient();
    String json =
        new String(
            java.util.Base64.getUrlDecoder().decode(seenAiRun.get()), StandardCharsets.UTF_8);
    assertThat(json).contains("\"kind\":\"WIKI_COMPOSE\"").contains("\"runId\"");
    org.mockito.Mockito.verifyNoInteractions(recorder);
  }

  @Test
  void aiRun_상태_502면_기존_동작을_지키고_http_502_를_기록한다() throws Exception {
    bootCapturing("{}", 502);
    try {
      callClient();
    } catch (RuntimeException e) {
      assertThat(e.getMessage()).contains("502");
    }
    org.mockito.ArgumentCaptor<com.workplace.airun.dto.AiRunRecord> cap =
        org.mockito.ArgumentCaptor.forClass(com.workplace.airun.dto.AiRunRecord.class);
    org.mockito.Mockito.verify(recorder, org.mockito.Mockito.times(1)).upsert(cap.capture());
    assertThat(cap.getValue().errorReason()).isNull();
    assertThat(cap.getValue().errorDetail()).isEqualTo("http_502");
    assertThat(cap.getValue().kind()).isEqualTo("WIKI_COMPOSE");
    assertThat(cap.getValue().status()).isEqualTo("FAILED");
  }

  @Test
  void aiRun_상태_400은_기록하지_않는다() throws Exception {
    bootCapturing("{}", 400);
    try {
      callClient();
    } catch (RuntimeException e) {
      // 기존 동작 유지
    }
    org.mockito.Mockito.verifyNoInteractions(recorder);
  }

  @Test
  void aiRun_연결_거부는_agent_unreachable_로_기록하고_예외는_그대로다() throws Exception {
    int closedPort;
    try (java.net.ServerSocket s = new java.net.ServerSocket(0)) {
      closedPort = s.getLocalPort();
    }
    AiAgentProperties props =
        new AiAgentProperties("http://127.0.0.1:" + closedPort, "changeme-local", true);
    client = new WikiAiAgentStreamClient(props, HttpClient.newHttpClient(), recorder);
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> client.stream("{}", t -> {}, () -> {}))
        .isInstanceOf(java.io.IOException.class);
    org.mockito.ArgumentCaptor<com.workplace.airun.dto.AiRunRecord> cap =
        org.mockito.ArgumentCaptor.forClass(com.workplace.airun.dto.AiRunRecord.class);
    org.mockito.Mockito.verify(recorder, org.mockito.Mockito.times(1)).upsert(cap.capture());
    assertThat(cap.getValue().errorReason()).isEqualTo("agent_unreachable");
  }

  @Test
  void aiRun_200_으로_시작한_뒤_끊겨도_기록하지_않는다() throws Exception {
    bootCapturing("event: delta\ndata: {\"text\":\"a\"}\n\n", 200);
    try {
      callClient();
    } catch (Exception e) {
      // 스트림 도중 종료 — 기존 동작
    }
    org.mockito.Mockito.verifyNoInteractions(recorder);
  }
}
