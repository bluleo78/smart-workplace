package com.workplace.global.outbound;

import static org.assertj.core.api.Assertions.assertThat;

import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpServer;
import com.workplace.auth.outbound.AssistantModelsConfig;
import com.workplace.drive.outbound.DriveOverviewStreamClient;
import com.workplace.drive.outbound.WorkerEmbedClient;
import com.workplace.fileai.outbound.AiAgentDriveConfig;
import com.workplace.fileai.outbound.WorkerClientConfig;
import com.workplace.fileai.outbound.WorkerProperties;
import com.workplace.home.outbound.AiAgentChatClient;
import com.workplace.home.outbound.HomeChatConfig;
import com.workplace.home.outbound.PriorityAiConfig;
import com.workplace.issue.outbound.IssueAiConfig;
import com.workplace.mail.outbound.MailAiConfig;
import com.workplace.messaging.outbound.MessagingAiConfig;
import com.workplace.wiki.outbound.WikiAiAgentStreamClient;
import com.workplace.wiki.outbound.WikiAiAgentSummaryConfig;
import java.io.IOException;
import java.lang.reflect.Field;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.web.client.RestClient;

/**
 * 평문 HTTP 내부 클라이언트 전부가 h2c 업그레이드 헤더 없이 HTTP/1.1 로 요청하는지 실제 소켓으로 검증한다(WP-305).
 *
 * <p>왜: JDK HttpClient 기본(HTTP/2)은 평문 http 요청에 {@code Connection: Upgrade, HTTP2-Settings} / {@code
 * Upgrade: h2c} 를 붙인다. 상대 서버(Node·uvicorn·프록시)가 이를 업그레이드 요청으로 오인하면 404/400 이 난다(WP-172 collab 사례).
 * 목 서버는 요청 팩토리를 갈아끼워 실제 헤더를 못 보므로, 운영과 같은 생성 경로(설정 {@code @Bean} 메서드·공개 {@code (props)} 생성자)로 만든
 * 클라이언트의 전송 계층(RestClient / HttpClient 필드)으로 로컬 HTTP 서버에 실제 요청을 보내 헤더를 기록·단언한다. 도메인 메서드 대신 전송 계층을
 * 직접 쓰는 이유: h2c 헤더는 요청 팩토리가 결정하므로 요청 본문 구성과 무관하고, 클라이언트마다 요청 DTO 를 만들 필요가 없어진다.
 */
class InternalHttpRealSocketTest {

  private static HttpServer server;
  private static String baseUrl;
  private static final List<Headers> captured = new CopyOnWriteArrayList<>();
  private static final List<String> paths = new CopyOnWriteArrayList<>();

  @BeforeEach
  void setUp() throws IOException {
    captured.clear();
    paths.clear();
    // 임의 포트(0)·루프백에만 바인딩. 모든 경로에 빈 JSON 으로 응답하며 헤더를 기록한다.
    server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
    server.createContext(
        "/",
        ex -> {
          ex.getRequestBody().readAllBytes();
          captured.add(ex.getRequestHeaders());
          paths.add(ex.getRequestURI().getPath());
          // /redirect 는 303 → /target. 내부 클라이언트는 따라가지 않아야 한다.
          if (ex.getRequestURI().getPath().equals("/redirect")) {
            ex.getResponseHeaders().add("Location", "/target");
            ex.sendResponseHeaders(303, -1);
            ex.close();
            return;
          }
          byte[] bytes = "{}".getBytes();
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

  /** 운영 생성 경로 — 이름과 (baseUrl → 클라이언트 객체) 팩토리. */
  static Stream<Arguments> internalClients() {
    Function<String, AiAgentProperties> ai = url -> new AiAgentProperties(url, "tok", true);
    Function<String, WorkerProperties> worker =
        url ->
            new WorkerProperties(url, "tok", true, new WorkerProperties.Embed("m", 3, 1000, true));
    return Stream.of(
        client(
            "HomeChat 누적 요약", u -> new HomeChatConfig().aiAgentContextSummaryClient(ai.apply(u))),
        client("HomeChat 스트림", u -> new AiAgentChatClient(ai.apply(u))),
        client("PriorityAi", u -> new PriorityAiConfig().aiAgentPriorityClient(ai.apply(u))),
        client(
            "AssistantModels", u -> new AssistantModelsConfig().aiAgentModelsClient(ai.apply(u))),
        client("MailAi", u -> new MailAiConfig().aiAgentMailClient(ai.apply(u))),
        client(
            "WikiAi 요약", u -> new WikiAiAgentSummaryConfig().wikiAiAgentSummaryClient(ai.apply(u))),
        client("WikiAi 스트림", u -> new WikiAiAgentStreamClient(ai.apply(u))),
        client("IssueAi", u -> new IssueAiConfig().aiAgentIssueClient(ai.apply(u))),
        client("AiAgentDrive", u -> new AiAgentDriveConfig().aiAgentDriveClient(ai.apply(u))),
        client("MessagingAi", u -> new MessagingAiConfig().aiAgentMessagingClient(ai.apply(u))),
        client("Catchup", u -> new MessagingAiConfig().aiAgentCatchupClient(ai.apply(u))),
        client("AiAgentEvent", u -> new OutboundConfig().aiAgentEventClient(ai.apply(u))),
        client("DriveOverview 스트림", u -> new DriveOverviewStreamClient(ai.apply(u))),
        client("Worker", u -> new WorkerClientConfig().workerClient(worker.apply(u))),
        client("WorkerEmbed", u -> new WorkerEmbedClient(worker.apply(u))));
  }

  private static Arguments client(String name, Function<String, Object> factory) {
    return Arguments.of(name, factory);
  }

  @ParameterizedTest(name = "{0}")
  @MethodSource("internalClients")
  void 내부_클라이언트는_h2c_업그레이드_헤더를_보내지_않는다(String name, Function<String, Object> factory)
      throws Exception {
    send(factory.apply(baseUrl), "/probe");

    assertThat(captured).as(name + " 요청 도달").hasSize(1);
    Headers h = captured.get(0);
    assertThat(h.containsKey("Upgrade")).as(name + " Upgrade 헤더").isFalse();
    assertThat(h.containsKey("HTTP2-Settings")).as(name + " HTTP2-Settings 헤더").isFalse();
    String connection = h.getFirst("Connection");
    assertThat(connection == null ? "" : connection.toLowerCase())
        .as(name + " Connection 헤더")
        .doesNotContain("upgrade");
  }

  /**
   * 3xx 는 따라가지 않는다 — 내부 서비스는 리다이렉트하지 않으므로 3xx 는 오설정 신호이고, 조용히 따라가면(303 은 POST 를 GET 으로 바꾼다) 엉뚱한 요청이
   * 성공처럼 보인다.
   */
  @ParameterizedTest(name = "{0}")
  @MethodSource("internalClients")
  void 내부_클라이언트는_리다이렉트를_따라가지_않는다(String name, Function<String, Object> factory) throws Exception {
    send(factory.apply(baseUrl), "/redirect");

    assertThat(paths).as(name + " 요청 경로").containsExactly("/redirect");
  }

  /** 클라이언트가 쥔 전송 계층(RestClient 또는 JDK HttpClient 필드)으로 요청 한 건을 보낸다. */
  private static void send(Object client, String path) throws Exception {
    for (Field f : client.getClass().getDeclaredFields()) {
      f.setAccessible(true);
      if (f.get(client) instanceof RestClient rest) {
        rest.post().uri(baseUrl + path).body("{}").retrieve().toBodilessEntity();
        return;
      }
      if (f.get(client) instanceof HttpClient http) {
        http.send(
            HttpRequest.newBuilder(URI.create(baseUrl + path))
                .POST(HttpRequest.BodyPublishers.ofString("{}"))
                .build(),
            HttpResponse.BodyHandlers.discarding());
        return;
      }
    }
    throw new AssertionError("전송 계층 필드 없음: " + client.getClass());
  }
}
