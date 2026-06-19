package com.workplace.home.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.HttpServer;
import com.workplace.global.outbound.AiAgentProperties;
import com.workplace.home.outbound.ComposeMessages.ComposeRequest;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * AiAgentComposeClient(JDK HttpClient ofLines) SSE 스트리밍 점진 전달 증명 테스트.
 *
 * <p>WikiAiAgentStreamClientTest 와 동일한 패턴. 로컬 HttpServer 스텁으로 SSE 를 실제 소켓에 흘려보내고, delta 토큰이 전체 본문
 * 도착 전에 점진적으로 소비되는지 검증한다.
 */
class HomeComposeStreamClientTest {

  private HttpServer server;
  private AiAgentComposeClient client;

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

  private void boot(String sseBody, int status) {
    server.createContext(
        "/ai/compose",
        exchange -> {
          byte[] payload = sseBody.getBytes(StandardCharsets.UTF_8);
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(status, 0); // 0 → chunked
          try (OutputStream os = exchange.getResponseBody()) {
            os.write(payload);
            os.flush();
          }
        });
    server.start();
    int port = server.getAddress().getPort();
    AiAgentProperties props =
        new AiAgentProperties("http://127.0.0.1:" + port, "changeme-local", true);
    client = new AiAgentComposeClient(props, HttpClient.newHttpClient());
  }

  private ComposeRequest dummyReq() {
    return new ComposeRequest("테스트", List.of(), 5L, "claude-sonnet-4-6", "NORMAL", 8, 60000);
  }

  /** delta×3 + done — 순서대로 소비하고 fullText/widgets 파싱이 올바른지 검증. */
  @Test
  void stream_deliversDeltasInOrder_thenDone() {
    String body =
        "event: delta\ndata: {\"text\":\"a\"}\n\n"
            + "event: delta\ndata: {\"text\":\"b\"}\n\n"
            + "event: delta\ndata: {\"text\":\"c\"}\n\n"
            + "event: done\ndata: {\"fullText\":\"abc\",\"widgets\":[{\"type\":\"my_tasks\"}]}\n\n";
    boot(body, 200);

    List<String> deltas = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    AtomicReference<String> fullText = new AtomicReference<>();

    client.composeStream(
        dummyReq(),
        deltas::add,
        (ft, widgets) -> {
          fullText.set(ft);
          done.set(true);
        },
        msg -> {
          throw new AssertionError("예상치 못한 오류: " + msg);
        },
        label -> {},
        node -> {});

    assertThat(deltas).containsExactly("a", "b", "c");
    assertThat(done).isTrue();
    assertThat(fullText.get()).isEqualTo("abc");
  }

  /**
   * 점진 전달(스트리밍) 증명 — 서버가 delta1 만 flush 한 뒤 latch 에 블록되고, 그 latch 는 client 의 onDelta("a") 가 풀어준다.
   * 버퍼링이면 onDelta("a") 가 영영 안 불려 latch 가 안 풀리고 단언이 실패한다. WikiAiAgentStreamClientTest 의 CP2 증명과 동일.
   */
  @Test
  void stream_isTrulyIncremental_notBufferedThenParsed() throws Exception {
    CountDownLatch firstSeen = new CountDownLatch(1);
    AtomicBoolean latchReleased = new AtomicBoolean(false);
    server.createContext(
        "/ai/compose",
        exchange -> {
          exchange.getResponseHeaders().add("Content-Type", "text/event-stream");
          exchange.sendResponseHeaders(200, 0); // chunked
          OutputStream os = exchange.getResponseBody();
          os.write("event: delta\ndata: {\"text\":\"a\"}\n\n".getBytes(StandardCharsets.UTF_8));
          os.flush();
          try {
            // client 가 "a" 를 소비해야만 latch 가 풀린다.
            latchReleased.set(firstSeen.await(5, TimeUnit.SECONDS));
          } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
          }
          os.write(
              "event: delta\ndata: {\"text\":\"b\"}\n\nevent: done\ndata: {\"fullText\":\"ab\",\"widgets\":null}\n\n"
                  .getBytes(StandardCharsets.UTF_8));
          os.flush();
          os.close();
        });
    server.start();
    int port = server.getAddress().getPort();
    AiAgentProperties props =
        new AiAgentProperties("http://127.0.0.1:" + port, "changeme-local", true);
    client = new AiAgentComposeClient(props, HttpClient.newHttpClient());

    List<String> deltas = new ArrayList<>();
    AtomicBoolean done = new AtomicBoolean(false);
    client.composeStream(
        dummyReq(),
        t -> {
          if (t.equals("a")) {
            firstSeen.countDown(); // 첫 토큰 소비 → 서버 진행 허용
          }
          deltas.add(t);
        },
        (ft, w) -> done.set(true),
        msg -> {
          throw new AssertionError("예상치 못한 오류: " + msg);
        },
        label -> {},
        node -> {});

    // 점진 전달 증명의 핵심 단언: latch 가 실제로 풀렸어야 한다.
    assertThat(latchReleased).isTrue();
    assertThat(deltas).containsExactly("a", "b");
    assertThat(done).isTrue();
  }

  /** event: error → onError 콜백 호출. */
  @Test
  void stream_errorEvent_callsOnError() {
    String body = "event: error\ndata: {\"message\":\"boom\"}\n\n";
    boot(body, 200);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(
        dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set, label -> {}, node -> {});

    assertThat(errorMsg.get()).isNotNull();
  }

  /** 503 home_composer_not_configured → onError 에 명확한 메시지. */
  @Test
  void stream_503_homeComposerNotConfigured_callsOnErrorWithClearMessage() {
    boot("{\"error\":\"home_composer_not_configured\"}", 503);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(
        dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set, label -> {}, node -> {});

    assertThat(errorMsg.get()).contains("설정되지 않");
  }
}
