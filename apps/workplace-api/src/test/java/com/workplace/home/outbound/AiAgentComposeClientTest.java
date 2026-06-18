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
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 로컬 HttpServer 스텁으로 SSE 를 실제 소켓에 흘려보내고, AiAgentComposeClient(composeStream) 가 delta/done/error 를
 * 올바르게 처리하는지 검증한다. WikiAiAgentStreamClientTest 와 동일한 패턴.
 */
class AiAgentComposeClientTest {

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

  /** 스텁을 기동하고 baseUrl 을 가리키는 client 를 만든다. */
  private void boot(String sseBody, int status) {
    server.createContext(
        "/home/compose",
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

  @Test
  void delta_두개와_done_이벤트를_정상_처리() {
    String body =
        "event: delta\ndata: {\"text\":\"안녕\"}\n\n"
            + "event: delta\ndata: {\"text\":\"하세요\"}\n\n"
            + "event: done\ndata: {\"fullText\":\"안녕하세요\",\"widgets\":[{\"type\":\"my_tasks\"}]}\n\n";
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
        });

    assertThat(deltas).containsExactly("안녕", "하세요");
    assertThat(done).isTrue();
    assertThat(fullText.get()).isEqualTo("안녕하세요");
  }

  @Test
  void error_이벤트는_onError_콜백으로_전달() {
    String body = "event: error\ndata: {\"message\":\"compose_failed\"}\n\n";
    boot(body, 200);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set);

    assertThat(errorMsg.get()).contains("실패");
  }

  @Test
  void 홈컴포저_미설정_503_은_onError_로_명확메시지_전달() {
    // 503 home_composer_not_configured → 사용자에게 명확한 메시지 전달.
    boot("{\"error\":\"home_composer_not_configured\"}", 503);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set);

    assertThat(errorMsg.get()).contains("설정되지 않");
  }

  @Test
  void 비200_응답은_onError_콜백으로_전달() {
    boot("{\"error\":\"invalid_payload\"}", 400);

    AtomicReference<String> errorMsg = new AtomicReference<>();
    client.composeStream(dummyReq(), delta -> {}, (ft, w) -> {}, errorMsg::set);

    assertThat(errorMsg.get()).isNotNull();
  }
}
