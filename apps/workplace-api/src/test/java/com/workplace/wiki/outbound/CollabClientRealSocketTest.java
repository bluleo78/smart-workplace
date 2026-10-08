package com.workplace.wiki.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.workplace.wiki.outbound.CollabClient.MergeBase;
import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * 실제 소켓 위에서 운영 빈 구성({@link CollabClientConfig})으로 만든 {@link CollabClient} 를 검증한다.
 *
 * <p>왜: JDK HttpClient 기본(HTTP/2)은 평문 http 요청에 {@code Connection: Upgrade, HTTP2-Settings} / {@code
 * Upgrade: h2c} 를 붙이고, 동기화 서버(Node, WebSocket upgrade 리스너 보유)는 이를 업그레이드 요청으로 보고 404 로 거절했다. 목 서버
 * (MockRestServiceServer)는 요청 팩토리를 갈아끼워 실제 헤더가 나가지 않으므로 이 결함을 못 잡는다 — 그래서 로컬 HTTP 서버로 실제 요청 헤더를 기록해
 * 단언한다.
 */
class CollabClientRealSocketTest {

  /** 받은 요청 한 건 — 경로·헤더·본문. 본문까지 담아 직렬화 계약(키 생략 포함)을 단언한다. */
  private record Captured(String path, Headers headers, String body) {}

  private HttpServer server;
  private final List<Captured> captured = new CopyOnWriteArrayList<>();
  private CollabClient client;

  @BeforeEach
  void setUp() throws IOException {
    // 임의 포트(0)·루프백에만 바인딩.
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/internal/docs/7/apply-markdown",
        ex -> respond(ex, 200, "{\"version\":4,\"body\":\"본문\"}"));
    server.createContext("/internal/docs/revalidate", ex -> respond(ex, 200, "{\"ok\":true}"));
    server.start();
    String baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    client = new CollabClientConfig().collabClient(new CollabProperties(baseUrl, "tok", true));
  }

  @AfterEach
  void tearDown() {
    server.stop(0);
  }

  /** 요청을 기록하고 JSON 으로 응답한다. 본문은 한 번만 끝까지 읽어(소켓을 비움) 그대로 기록한다 — 두 번 읽으면 빈 값이 된다. */
  private void respond(HttpExchange ex, int status, String json) throws IOException {
    captured.add(
        new Captured(
            ex.getRequestURI().getPath(),
            ex.getRequestHeaders(),
            new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
    byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().add("Content-Type", "application/json");
    ex.sendResponseHeaders(status, bytes.length);
    try (var out = ex.getResponseBody()) {
      out.write(bytes);
    }
  }

  /** h2c 업그레이드 흔적이 없어야 한다 — 동기화 서버가 업그레이드 요청으로 오인하지 않게. */
  private static void assertPlainHttp1(Captured c) {
    assertThat(c.headers().containsKey("Upgrade")).as("Upgrade 헤더").isFalse();
    assertThat(c.headers().containsKey("HTTP2-Settings")).as("HTTP2-Settings 헤더").isFalse();
    String connection = c.headers().getFirst("Connection");
    assertThat(connection == null ? "" : connection.toLowerCase()).doesNotContain("upgrade");
    assertThat(c.headers().getFirst("Authorization")).isEqualTo("Internal tok");
  }

  @Test
  void apply_markdown은_h2c_업그레이드_없이_HTTP1로_보내고_응답을_받는다() {
    var res =
        client.applyMarkdown(1L, 7L, new MergeBase("기준", null), "본문", 3L, "협업자", false, false);

    assertThat(res.version()).isEqualTo(4);
    assertThat(res.body()).isEqualTo("본문");
    assertThat(captured).hasSize(1);
    assertThat(captured.get(0).path()).isEqualTo("/internal/docs/7/apply-markdown");
    assertPlainHttp1(captured.get(0));
  }

  @Test
  void revalidate도_h2c_업그레이드_없이_HTTP1로_보낸다() {
    client.revalidate(new CollabClient.RevalidateRequest(1L, 2L, null, null));

    assertThat(captured).hasSize(1);
    assertThat(captured.get(0).path()).isEqualTo("/internal/docs/revalidate");
    assertPlainHttp1(captured.get(0));
  }

  @Test
  void revalidate는_삭제_사유를_싣고_없는_키는_생략한다() {
    client.revalidate(
        new CollabClient.RevalidateRequest(
            1L, 2L, List.of(7L, 8L), null, CollabClient.RevalidateRequest.REASON_DELETED));
    client.revalidate(new CollabClient.RevalidateRequest(1L, 2L, null, 5L));

    assertThat(captured).hasSize(2);
    // 삭제 재검증 — collab 이 4404(삭제)로 닫도록 사유를 싣는다.
    assertThat(captured.get(0).body())
        .contains("\"reason\":\"deleted\"")
        .contains("\"pageIds\":[7,8]");
    assertThat(captured.get(0).body()).doesNotContain("userId");
    // 멤버 변경 — 사유 키 자체가 없어야 구버전 collab 도 그대로 받는다.
    assertThat(captured.get(1).body()).doesNotContain("reason").contains("\"userId\":5");
  }
}
