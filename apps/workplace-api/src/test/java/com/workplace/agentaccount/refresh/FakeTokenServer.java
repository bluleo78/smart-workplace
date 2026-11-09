package com.workplace.agentaccount.refresh;

import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * 갱신 테스트용 가짜 토큰 서버(JDK HttpServer, 루프백 임의 포트). 받은 요청(본문·Content-Type)을 기록하고, 정해 둔 상태·본문으로 응답한다. 응답
 * 전에 지연을 두거나 훅을 실행할 수 있다(응답 중 경합 재현).
 */
final class FakeTokenServer implements AutoCloseable {

  /** 받은 요청 한 건. */
  record Received(String contentType, String body) {}

  private final HttpServer server;
  final List<Received> requests = new CopyOnWriteArrayList<>();

  volatile int status = 200;
  volatile String responseBody = "{}";
  volatile long delayMillis = 0;
  volatile Runnable onRequest = () -> {};

  FakeTokenServer() throws IOException {
    server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
    server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
    server.createContext(
        "/oauth/token",
        ex -> {
          String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
          requests.add(new Received(ex.getRequestHeaders().getFirst("Content-Type"), body));
          onRequest.run();
          if (delayMillis > 0) {
            try {
              Thread.sleep(delayMillis);
            } catch (InterruptedException ie) {
              Thread.currentThread().interrupt();
            }
          }
          byte[] out = responseBody.getBytes(StandardCharsets.UTF_8);
          ex.getResponseHeaders().add("Content-Type", "application/json");
          ex.sendResponseHeaders(status, out.length);
          ex.getResponseBody().write(out);
          ex.close();
        });
    server.start();
  }

  /** 토큰 갱신 주소. */
  String url() {
    return "http://127.0.0.1:" + server.getAddress().getPort() + "/oauth/token";
  }

  @Override
  public void close() {
    server.stop(0);
  }
}
