package com.workplace.global.net;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.workplace.global.net.SafeHttpFetcher.FetchException;
import com.workplace.global.net.SafeHttpFetcher.Fetched;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * WP-874: 가드된 HTTP 가져오기 — 내부 주소·포트·scheme 거절, 리다이렉트 홉마다 재검사, DNS 재바인딩(연결 시점 재해석) 차단, 본문 상한·형식·전체
 * 시간. 실제 인터넷에 나가지 않는다 — 외부 이름은 가짜 리졸버로 정하고, 성공 경로는 127.0.0.1 로컬 서버를 신뢰 호스트로 둔 인스턴스로 시험한다.
 */
class SafeHttpFetcherTest {

  private HttpServer server;
  private String base;
  private final AtomicInteger rebindCalls = new AtomicInteger();

  /** 가짜 DNS — 외부처럼 보이는 이름들의 해석 결과를 정한다. 나머지(IP 리터럴)는 JDK 로 푼다(DNS 질의 없음). */
  private InetAddress[] fakeDns(String host) throws UnknownHostException {
    return switch (host) {
      case "evil.test", "my_internal.test" -> new InetAddress[] {InetAddress.getByName("10.1.2.3")};
      case "my_site.test" -> new InetAddress[] {InetAddress.getByName("127.0.0.1")};
      case "meta.test" -> new InetAddress[] {InetAddress.getByName("169.254.169.254")};
      case "mixed.test" ->
          new InetAddress[] {
            InetAddress.getByName("93.184.216.34"), InetAddress.getByName("10.0.0.1")
          };
      // 첫 해석은 공인 IP, 그 다음은 루프백 — 재바인딩 공격 흉내. 연결 계층이 단 한 번 푼 결과만 쓰므로 첫 해석(공인)으로 붙으려다
      // 연결이 실패하거나(인터넷 없음), 두 번째 해석이 생기면 그때 차단된다. 해석 횟수로 「한 번만 푼다」를 검증한다.
      case "rebind.test" ->
          new InetAddress[] {
            InetAddress.getByName(
                rebindCalls.incrementAndGet() == 1 ? "93.184.216.34" : "127.0.0.1")
          };
      default -> InetAddress.getAllByName(host);
    };
  }

  private final SafeHttpFetcher strict = new SafeHttpFetcher(this::fakeDns, Set.of());
  private final SafeHttpFetcher local =
      new SafeHttpFetcher(this::fakeDns, Set.of("127.0.0.1", "my_site.test"));

  @BeforeEach
  void startServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.createContext(
        "/page", ex -> send(ex, 200, "text/html; charset=utf-8", "<title>ok</title>"));
    server.createContext("/json", ex -> send(ex, 200, "application/json", "{}"));
    server.createContext("/big", ex -> send(ex, 200, "text/html", "x".repeat(4096)));
    server.createContext("/redir-ok", ex -> redirect(ex, "/page"));
    server.createContext("/redir-internal", ex -> redirect(ex, "http://evil.test/x"));
    server.createContext("/redir-meta", ex -> redirect(ex, "http://meta.test/latest/meta-data"));
    server.createContext("/redir-localhost", ex -> redirect(ex, "http://localhost/"));
    server.createContext("/redir-loop", ex -> redirect(ex, "/redir-loop"));
    // 날 공백·| 가 든 Location — 브라우저처럼 인코딩해 따라가야 한다(비-ASCII 는 HttpServer 가 헤더로 못 보내 단위 단언으로 본다).
    server.createContext("/redir-raw", ex -> redirect(ex, "/echo?q=a b|c&ok=%41"));
    server.createContext(
        "/echo", ex -> send(ex, 200, "text/html", ex.getRequestURI().getRawQuery()));
    server.createContext("/unavailable", ex -> send(ex, 503, "text/html", "down"));
    server.createContext("/gone", ex -> send(ex, 404, "text/html", "no"));
    server.createContext(
        "/trickle",
        ex -> {
          // 헤더는 바로, 본문은 1바이트씩 0.8초 간격 — 소켓 타임아웃(3초)엔 안 걸리지만 전체 5초는 넘는다.
          ex.getResponseHeaders().add("Content-Type", "text/html");
          ex.sendResponseHeaders(200, 0);
          try (OutputStream os = ex.getResponseBody()) {
            for (int i = 0; i < 20; i++) {
              os.write('a');
              os.flush();
              Thread.sleep(800);
            }
          } catch (InterruptedException | IOException ignored) {
            // 클라이언트가 끊으면 끝
          }
        });
    server.start();
    base = "http://127.0.0.1:" + server.getAddress().getPort();
  }

  @AfterEach
  void stopServer() {
    server.stop(0);
    strict.close();
    local.close();
  }

  private static void send(HttpExchange ex, int status, String type, String body)
      throws IOException {
    byte[] b = body.getBytes(StandardCharsets.UTF_8);
    ex.getResponseHeaders().add("Content-Type", type);
    ex.sendResponseHeaders(status, b.length);
    try (OutputStream os = ex.getResponseBody()) {
      os.write(b);
    }
  }

  private static void redirect(HttpExchange ex, String location) throws IOException {
    ex.getResponseHeaders().add("Location", location);
    ex.sendResponseHeaders(302, -1);
    ex.close();
  }

  private Fetched html(SafeHttpFetcher f, String url) throws FetchException {
    return f.fetch(url, "text/html", "text/html"::equals, 1024);
  }

  @Test
  void rejects_internal_addresses_atConnectTimeResolution() {
    // 사전 검사는 구문만 본다 — IP 대역은 연결 계층의 검사형 리졸버가 거절해야 하고, 실패 이유도 「내부 주소 차단」이어야 한다
    // (연결 거부 같은 다른 이유로 우연히 실패한 것이 아님).
    for (String url :
        List.of(
            "http://127.0.0.1/",
            "http://10.0.0.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://localhost/",
            "http://foo.localhost./",
            "http://evil.test/",
            "http://mixed.test/",
            "http://my_internal.test/")) {
      assertThatThrownBy(() -> html(strict, url))
          .as(url)
          .isInstanceOf(FetchException.class)
          .hasMessage("내부 주소 차단");
    }
  }

  @Test
  void rejects_scheme_port_userinfo_syntactically() {
    assertThatThrownBy(() -> html(strict, "ftp://93.184.216.34/")).hasMessage("http(s) 만");
    assertThatThrownBy(() -> html(strict, "http://93.184.216.34:8080/")).hasMessage("허용하지 않는 포트");
    assertThatThrownBy(() -> html(strict, base + "/page")).hasMessage("허용하지 않는 포트");
    assertThatThrownBy(() -> html(strict, "http://user@93.184.216.34/")).hasMessage("사용자 정보가 든 주소");
    // 밑줄 호스트도 authority 로 읽어 사용자 정보를 거른다.
    assertThatThrownBy(() -> html(strict, "http://u@my_site.test/")).hasMessage("사용자 정보가 든 주소");
  }

  @Test
  void underscoreHost_isParsed_andFetched() throws Exception {
    // java.net.URI#getHost 가 null 인 밑줄 호스트 — authority 로 읽어 정상 접속한다.
    Fetched f = html(local, "http://my_site.test:" + server.getAddress().getPort() + "/page");
    assertThat(new String(f.body(), StandardCharsets.UTF_8)).isEqualTo("<title>ok</title>");
  }

  @Test
  void redirectLocation_withRawSpaceAndNonAscii_isPercentEncoded() throws Exception {
    Fetched f = html(local, base + "/redir-raw");
    assertThat(new String(f.body(), StandardCharsets.UTF_8)).isEqualTo("q=a%20b%7Cc&ok=%41");
    assertThat(SafeHttpFetcher.encodeIllegal("/한 글?x=1")).isEqualTo("/%ED%95%9C%20%EA%B8%80?x=1");
    assertThat(SafeHttpFetcher.encodeIllegal("/a b|c%41%zz%")).isEqualTo("/a%20b%7Cc%41%25zz%25");
  }

  @Test
  void transientVsDefinitiveFailures() {
    assertThatThrownBy(() -> html(local, base + "/unavailable"))
        .isInstanceOfSatisfying(FetchException.class, e -> assertThat(e.isTransient()).isTrue());
    assertThatThrownBy(() -> html(local, base + "/gone"))
        .isInstanceOfSatisfying(FetchException.class, e -> assertThat(e.isTransient()).isFalse());
    assertThatThrownBy(() -> html(local, base + "/json"))
        .isInstanceOfSatisfying(FetchException.class, e -> assertThat(e.isTransient()).isFalse());
    assertThatThrownBy(() -> html(strict, "http://evil.test/"))
        .isInstanceOfSatisfying(FetchException.class, e -> assertThat(e.isTransient()).isFalse());
  }

  @Test
  void dnsRebinding_connectTimeResolution_isVettedAgain() {
    // 첫 해석이 루프백이 되도록 한 번 소모해 둔다 → 연결 계층의 유일한 해석이 내부 주소를 받는다.
    rebindCalls.set(1);
    assertThatThrownBy(() -> html(strict, "http://rebind.test/"))
        .isInstanceOf(FetchException.class)
        .hasMessage("내부 주소 차단");
    // 홉당 이름 해석은 연결 계층의 검사형 리졸버 한 번뿐 — 검사한 결과와 연결한 결과가 갈릴 틈이 없다.
    assertThat(rebindCalls.get()).isEqualTo(2);
  }

  @Test
  void fetches_and_follows_safe_redirect() throws Exception {
    Fetched f = html(local, base + "/redir-ok");
    assertThat(f.mimeType()).isEqualTo("text/html");
    assertThat(f.charset()).isEqualTo("utf-8");
    assertThat(new String(f.body(), StandardCharsets.UTF_8)).isEqualTo("<title>ok</title>");
    assertThat(f.finalUri().getPath()).isEqualTo("/page");
  }

  @Test
  void redirect_toInternal_isRejectedEveryHop() {
    for (String path : List.of("/redir-internal", "/redir-meta", "/redir-localhost")) {
      assertThatThrownBy(() -> html(local, base + path))
          .as(path)
          .isInstanceOf(FetchException.class);
    }
  }

  @Test
  void tooManyRedirects_bodyCap_wrongType_rejected() {
    assertThatThrownBy(() -> html(local, base + "/redir-loop"))
        .isInstanceOf(FetchException.class)
        .hasMessage("리다이렉트가 너무 많습니다");
    assertThatThrownBy(() -> html(local, base + "/big"))
        .isInstanceOf(FetchException.class)
        .hasMessage("본문 상한 초과");
    assertThatThrownBy(() -> html(local, base + "/json"))
        .isInstanceOf(FetchException.class)
        .hasMessageContaining("허용하지 않는 형식");
  }

  @Test
  void slowTrickle_isCutAtTotalTimeout() {
    long start = System.currentTimeMillis();
    assertThatThrownBy(() -> local.fetch(base + "/trickle", "text/html", m -> true, 1024 * 1024))
        .isInstanceOfSatisfying(FetchException.class, e -> assertThat(e.isTransient()).isTrue());
    assertThat(System.currentTimeMillis() - start)
        .isLessThan(SafeHttpFetcher.TOTAL_TIMEOUT_MS + 2000);
  }
}
